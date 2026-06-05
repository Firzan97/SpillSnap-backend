import {
  BadGatewayException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AuthProvider, User } from '../users/entities/user.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const TRIAL_DAYS = 7;

/** Subset of the GoTrue user object we care about. */
export interface GoTrueUser {
  id: string;
  email?: string;
  phone?: string;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: Record<string, unknown>;
  confirmation_sent_at?: string;
}

/** GoTrue token / session response. */
export interface GoTrueSession {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  user?: GoTrueUser;
}

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
 * Claims from a Supabase-issued access token (GoTrue).
 * Supabase Auth owns credentials, OAuth (Google), email verification,
 * password reset, etc. This backend only verifies the token and mirrors the
 * user into our local `users` table so the rest of the app has a profile row.
 */
export interface SupabaseJwtPayload {
  sub: string; // Supabase auth.users id (uuid)
  email?: string;
  phone?: string;
  aud: string; // 'authenticated'
  role?: string;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
    [k: string]: unknown;
  };
}

@Injectable()
export class AuthService {
  private readonly supabaseUrl: string;
  private readonly anonKey: string;
  /** Deep link the confirmation email returns to (opens the mobile app). */
  private readonly authRedirectUrl: string;

  constructor(
    private readonly usersService: UsersService,
    config: ConfigService,
  ) {
    // Accept the bare project URL even if someone pasted the PostgREST base
    // (".../rest/v1") — GoTrue lives at the project root, not under /rest.
    this.supabaseUrl = config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/(rest\/v1\/?|auth\/v1\/?)?$/, '');
    this.anonKey = config.getOrThrow<string>('SUPABASE_ANON_KEY');
    this.authRedirectUrl =
      config.get<string>('APP_AUTH_REDIRECT_URL') ??
      'spendsnap://auth-callback';
  }

  /**
   * Register via Supabase Auth (GoTrue). If email confirmation is OFF a session
   * is returned and the local profile is synced immediately; if it's ON, the
   * user must confirm before they can log in.
   */
  async register(dto: RegisterDto) {
    // `redirect_to` is what GoTrue bakes into the confirmation email link, so
    // tapping it on a phone deep-links back into the app (spendsnap://…).
    const path = `/auth/v1/signup?redirect_to=${encodeURIComponent(this.authRedirectUrl)}`;
    const session = await this.gotrue(path, {
      email: dto.email,
      password: dto.password,
      data: {
        ...(dto.name ? { full_name: dto.name } : {}),
        ...(dto.phone ? { phone: dto.phone } : {}),
      },
    });

    // Session present → confirmation disabled → mirror the user now.
    const profile = session.access_token
      ? await this.syncFromSupabase(this.toPayload(session.user))
      : null;

    return {
      ...session,
      emailConfirmationRequired: !session.access_token,
      profile: profile ? this.toPublic(profile) : null,
    };
  }

  /** Log in with email + password via GoTrue, then sync the local profile. */
  async login(dto: LoginDto) {
    let session: GoTrueSession;
    try {
      session = await this.gotrue('/auth/v1/token?grant_type=password', {
        email: dto.email,
        password: dto.password,
      });
    } catch (err) {
      throw await this.refineLoginError(err, dto.email);
    }

    const profile = await this.syncFromSupabase(this.toPayload(session.user));

    return { ...session, profile: this.toPublic(profile) };
  }

  /**
   * GoTrue returns a generic 400 "Invalid login credentials" for both an
   * unknown email and a wrong password (anti-enumeration). Turn that into
   * clearer 401s: if the email exists in our mirrored `users` table it's a
   * wrong password, otherwise the account isn't recognised.
   */
  private async refineLoginError(
    err: unknown,
    email: string,
  ): Promise<HttpException> {
    if (!(err instanceof HttpException)) {
      return new BadGatewayException(
        err instanceof Error ? err.message : 'Login failed',
      );
    }

    const raw = (err.message ?? '').toLowerCase();

    if (raw.includes('not confirmed')) {
      return new UnauthorizedException(
        'Email not confirmed. Check your inbox to verify your account.',
      );
    }

    if (
      err.getStatus() === 400 ||
      raw.includes('invalid login credentials') ||
      raw.includes('invalid_grant')
    ) {
      const existing = await this.usersService.findByEmail(email);
      return existing
        ? new UnauthorizedException('Wrong password')
        : new UnauthorizedException('No account found for this email');
    }

    return err;
  }

  /**
   * Send a password-reset email via GoTrue. The link carries `redirect_to` so
   * tapping it deep-links into the app's New Password screen. Always resolves
   * (GoTrue returns 200 even for unknown emails) so we never leak which emails
   * are registered.
   */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const path = `/auth/v1/recover?redirect_to=${encodeURIComponent(this.authRedirectUrl)}`;
    try {
      await this.gotrue(path, { email });
    } catch {
      // Swallow — don't reveal whether the address exists.
    }
    return { ok: true };
  }

  /**
   * Set a new password using the recovery access token from the reset deep
   * link, then sync + return the local profile. The same token stays valid as
   * a session, so the client can use it to land the user signed in.
   */
  async resetPassword(accessToken: string, password: string) {
    const user = await this.gotrueAuthed('/auth/v1/user', 'PUT', accessToken, {
      password,
    });
    const profile = await this.syncFromSupabase(this.toPayload(user));
    return { access_token: accessToken, profile: this.toPublic(profile) };
  }

  /** Call a GoTrue endpoint with a user's bearer token (not the anon key). */
  private async gotrueAuthed(
    path: string,
    method: string,
    bearer: string,
    body: Record<string, unknown>,
  ): Promise<GoTrueUser> {
    let res: Response;
    try {
      res = await fetch(`${this.supabaseUrl}${path}`, {
        method,
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException('Could not reach Supabase Auth');
    }

    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const message =
        (data.error_description as string) ||
        (data.msg as string) ||
        (data.error as string) ||
        'Could not reset password';
      // 401/403 here means the recovery link expired or was already used.
      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedException(
          'This reset link has expired or already been used. Request a new one.',
        );
      }
      throw new HttpException(message, res.status);
    }
    return data as unknown as GoTrueUser;
  }

  /** POST to GoTrue and normalise its error shape into HTTP exceptions. */
  private async gotrue(
    path: string,
    body: Record<string, unknown>,
  ): Promise<GoTrueSession> {
    let res: Response;
    try {
      res = await fetch(`${this.supabaseUrl}${path}`, {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException('Could not reach Supabase Auth');
    }

    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!res.ok) {
      // GoTrue uses { error, error_description } or { msg, error_code }.
      const message =
        (data.error_description as string) ||
        (data.msg as string) ||
        (data.error as string) ||
        'Authentication failed';
      throw new HttpException(message, res.status);
    }

    return data as GoTrueSession;
  }

  /** Map a GoTrue user object onto the JWT-claim shape syncFromSupabase expects. */
  private toPayload(user?: GoTrueUser): SupabaseJwtPayload {
    if (!user?.id) {
      throw new BadGatewayException('Supabase returned no user');
    }
    return {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      aud: 'authenticated',
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
    };
  }

  /**
   * Resolve a verified Supabase token to a local user, creating the profile
   * on first sign-in and keeping email/name/avatar in sync afterwards.
   */
  async syncFromSupabase(payload: SupabaseJwtPayload): Promise<User> {
    const email = (
      payload.email ?? `${payload.sub}@no-email.supabase`
    ).toLowerCase();
    const meta = payload.user_metadata ?? {};
    const name =
      meta.full_name || meta.name || email.split('@')[0] || 'SpendSnap User';
    const avatarUrl = meta.avatar_url ?? meta.picture ?? null;
    const authProvider = this.mapProvider(payload.app_metadata?.provider);

    const existing = await this.usersService.findBySupabaseId(payload.sub);
    if (existing) {
      // Keep the mirror fresh without clobbering app-owned fields.
      return this.usersService.update(existing.id, {
        email,
        name: existing.name || name,
        avatarUrl: avatarUrl ?? existing.avatarUrl,
        authProvider,
        phone: payload.phone ?? existing.phone,
      });
    }

    // No row for this Supabase id yet. A row may still exist under the same
    // email — e.g. the Supabase auth user was recreated (new `sub`) while the
    // old mirror lingered. `email` is unique, so re-link that row to the new
    // Supabase id instead of inserting a duplicate (which 500s on the
    // unique-email constraint).
    const byEmail = await this.usersService.findByEmail(email);
    if (byEmail) {
      return this.usersService.update(byEmail.id, {
        supabaseId: payload.sub,
        providerId: byEmail.providerId ?? payload.sub,
        name: byEmail.name || name,
        avatarUrl: avatarUrl ?? byEmail.avatarUrl,
        authProvider,
        phone: payload.phone ?? byEmail.phone,
      });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    return this.usersService.create({
      supabaseId: payload.sub,
      email,
      name,
      avatarUrl,
      authProvider,
      providerId: payload.sub,
      phone: payload.phone ?? null,
      trialEndsAt,
    });
  }

  private mapProvider(provider?: string): AuthProvider {
    switch (provider) {
      case 'google':
        return AuthProvider.GOOGLE;
      default:
        return AuthProvider.EMAIL;
    }
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
