import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { UsersService } from '../users/users.service';
import { AuthProvider, User } from '../users/entities/user.entity';

const TRIAL_DAYS = 7;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  streakCount: number;
  trialEndsAt: Date | null;
  avatarUrl: string | null;
  baseCurrency: string;
  authProvider: string;
}

/**
 * Claims from a Clerk-issued session token.
 *
 * Clerk Auth owns credentials, OAuth (Google), email verification and password
 * reset - all handled by the Clerk SDKs on the client. This backend only
 * verifies the session token and mirrors the user into our local `users` table
 * so the rest of the app has a profile row. Clerk's default session token only
 * carries `sub` (the Clerk user id); email/name/avatar are fetched from the
 * Clerk Backend API on first sign-in.
 */
export interface ClerkJwtPayload {
  sub: string; // Clerk user id (e.g. user_2abc…)
  email?: string;
  [k: string]: unknown;
}

@Injectable()
export class AuthService {
  private readonly clerk: ClerkClient;

  constructor(
    private readonly usersService: UsersService,
    config: ConfigService,
  ) {
    this.clerk = createClerkClient({
      secretKey: config.getOrThrow<string>('CLERK_SECRET_KEY'),
    });
  }

  /**
   * Resolve a verified Clerk session to a local user. On first sign-in for a
   * Clerk id we fetch the authoritative profile (email/name/avatar/provider)
   * from the Clerk Backend API and create the mirror row; afterwards we return
   * the existing row without an API round-trip on every request.
   */
  async syncFromClerk(payload: ClerkJwtPayload): Promise<User> {
    const existing = await this.usersService.findByClerkId(payload.sub);
    if (existing) return existing;

    // First sign-in for this Clerk id - pull the full profile from Clerk.
    const clerkUser = await this.clerk.users.getUser(payload.sub);

    const email = (
      clerkUser.primaryEmailAddress?.emailAddress ||
      clerkUser.emailAddresses[0]?.emailAddress ||
      payload.email ||
      `${payload.sub}@no-email.clerk`
    ).toLowerCase();
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser.username ||
      email.split('@')[0] ||
      'SpillSnap User';
    const avatarUrl = clerkUser.imageUrl || null;
    // Prefer a verified Clerk phone identifier, but fall back to the plain
    // number the web sign-up stashes in unsafeMetadata.phone (optional field, no
    // SMS/OTP - mirrors the mobile app, which stores phone unverified too).
    const phone =
      clerkUser.primaryPhoneNumber?.phoneNumber ??
      (typeof clerkUser.unsafeMetadata?.phone === 'string'
        ? clerkUser.unsafeMetadata.phone
        : null);
    const authProvider = this.mapProvider(clerkUser);

    // A row may already exist under the same email - e.g. migrated from the old
    // Supabase mirror. `email` is unique, so re-link it to the Clerk id instead
    // of inserting a duplicate (which 500s on the unique-email constraint).
    const byEmail = await this.usersService.findByEmail(email);
    if (byEmail) {
      return this.usersService.update(byEmail.id, {
        clerkId: payload.sub,
        providerId: byEmail.providerId ?? payload.sub,
        name: byEmail.name || name,
        avatarUrl: avatarUrl ?? byEmail.avatarUrl,
        authProvider,
        phone: phone ?? byEmail.phone,
      });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    return this.usersService.create({
      clerkId: payload.sub,
      email,
      name,
      avatarUrl,
      authProvider,
      providerId: payload.sub,
      phone,
      trialEndsAt,
    });
  }

  /** Map the user's connected accounts onto our local provider enum. */
  private mapProvider(
    user: Awaited<ReturnType<ClerkClient['users']['getUser']>>,
  ): AuthProvider {
    const hasGoogle = user.externalAccounts?.some((a) =>
      a.provider?.includes('google'),
    );
    return hasGoogle ? AuthProvider.GOOGLE : AuthProvider.EMAIL;
  }

  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      role: user.role,
      streakCount: user.streakCount,
      trialEndsAt: user.trialEndsAt ?? null,
      avatarUrl: user.avatarUrl ?? null,
      baseCurrency: user.baseCurrency ?? 'MYR',
      authProvider: user.authProvider,
    };
  }
}
