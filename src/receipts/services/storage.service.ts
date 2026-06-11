import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SIGNED_URL_TTL = 60 * 60; // 1 hour

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/**
 * Wraps Supabase Storage for receipt images. Objects live in a private bucket
 * at `<userId>/<uuid>.<ext>`; the DB stores that path, and we hand the client a
 * short-lived signed URL on read.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: ReturnType<typeof createClient>;
  private readonly bucket: string;
  /** Public bucket for profile avatars (objects served via a stable public URL). */
  private readonly avatarBucket: string;

  constructor(config: ConfigService) {
    this.client = createClient(
      config.getOrThrow('SUPABASE_URL'),
      config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } },
    );
    this.bucket = config.get('STORAGE_BUCKET', 'receipts');
    this.avatarBucket = config.get('AVATAR_BUCKET', 'avatars');
  }

  async uploadReceiptImage(
    userId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
    const ext = EXT_BY_MIME[file.mimetype] ?? 'jpg';
    const path = `${userId}/${randomUUID()}.${ext}`;

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw new InternalServerErrorException('Failed to store receipt image');
    }
    return path;
  }

  /**
   * Upload a profile avatar to the public avatar bucket and return its stable
   * public URL. Overwrites the user's previous avatar (`upsert`) so the path is
   * deterministic per user and old objects don't accumulate.
   */
  async uploadAvatar(
    userId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
    const ext = EXT_BY_MIME[file.mimetype] ?? 'jpg';
    const path = `${userId}/avatar.${ext}`;

    const { error } = await this.client.storage
      .from(this.avatarBucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });

    if (error) {
      this.logger.error(`Avatar upload failed: ${error.message}`);
      throw new InternalServerErrorException('Failed to store avatar');
    }

    const { data } = this.client.storage
      .from(this.avatarBucket)
      .getPublicUrl(path);
    // Bust client/CDN caches when a user re-uploads to the same path.
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  /**
   * Best-effort delete of a previously uploaded avatar. Only removes objects we
   * own (public URLs in the avatar bucket); external URLs (e.g. Google) are left
   * alone.
   */
  async removeAvatar(url: string | null): Promise<void> {
    if (!url) return;
    const marker = `/${this.avatarBucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return; // not one of ours (external provider avatar)
    const path = url.slice(idx + marker.length).split('?')[0];
    const { error } = await this.client.storage
      .from(this.avatarBucket)
      .remove([path]);
    if (error)
      this.logger.warn(`Avatar delete failed for ${path}: ${error.message}`);
  }

  /** Turn a stored path into a temporary, client-usable URL. */
  async getSignedUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (error) {
      this.logger.warn(`Sign URL failed for ${path}: ${error.message}`);
      return null;
    }
    return data.signedUrl;
  }

  async remove(path: string | null): Promise<void> {
    if (!path) return;
    await this.removeMany([path]);
  }

  async removeMany(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(paths);
    if (error) this.logger.warn(`Bulk delete failed: ${error.message}`);
  }

  /**
   * List every stored object as `<userFolder>/<file>` with its creation time.
   * Objects are namespaced per user, so we list the root folders then their files.
   */
  async listAllObjects(): Promise<{ path: string; createdAt: number }[]> {
    const root = this.client.storage.from(this.bucket);
    const { data: folders, error } = await root.list('', { limit: 1000 });
    if (error || !folders) {
      this.logger.warn(`List root failed: ${error?.message}`);
      return [];
    }

    const out: { path: string; createdAt: number }[] = [];
    for (const folder of folders) {
      // Real files have metadata; folders don't - recurse into folders only.
      if (folder.id) continue;
      const { data: files } = await root.list(folder.name, { limit: 1000 });
      for (const f of files ?? []) {
        if (!f.id) continue;
        out.push({
          path: `${folder.name}/${f.name}`,
          createdAt: new Date(f.created_at ?? Date.now()).getTime(),
        });
      }
    }
    return out;
  }
}
