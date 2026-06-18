import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { UsersService } from '../users/users.service';
import { AuthProvider, User } from '../users/entities/user.entity';
import { WhatsappSenderService } from '../whatsapp/whatsapp-sender.service';

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
  private readonly logger = new Logger(AuthService.name);
  private readonly clerk: ClerkClient;

  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappSenderService,
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
      [clerkUser.firstName, clerkUser.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
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

    // New users start on the Free plan with NO trial. A trial is only ever
    // granted by Stripe AFTER the user starts a paid subscription (the webhook
    // sets the subscription's `trialing` status); signup never grants Pro.
    let created: User;
    try {
      created = await this.usersService.create({
        clerkId: payload.sub,
        email,
        name,
        avatarUrl,
        authProvider,
        providerId: payload.sub,
        phone,
        trialEndsAt: null,
      });
    } catch (e) {
      // On first sign-in the client fires several authed requests at once
      // (dashboard, relief, subscription). They all reach here, all see no
      // existing row, and race to INSERT — the losers hit the unique
      // clerkId/email constraint. That's not an error: re-read the row the
      // winner just created and use it. Without this, the failed requests 401
      // and the app bounces the user back to the sign-in screen.
      const raced =
        (await this.usersService.findByClerkId(payload.sub)) ??
        (await this.usersService.findByEmail(email));
      if (raced) return raced;
      throw e;
    }

    // First-time signup → WhatsApp onboarding (only fires if a phone is already
    // known, e.g. the web email-signup form; Google users add it in-app later).
    void this.sendOnboardingIfNeeded(created);

    return created;
  }

  /**
   * Business-initiated WhatsApp onboarding, sent exactly once per user. Called
   * on first signup (if a phone is already known) and again when the user later
   * saves their phone number in-app. Idempotent via `waOnboardedAt`, so editing
   * the phone afterwards never re-sends. No-op unless the sender is configured,
   * a template name is set, and the user has a phone. Best-effort: never throws.
   */
  async sendOnboardingIfNeeded(user: User): Promise<void> {
    if (user.waOnboardedAt) return; // already greeted once
    const phone = user.phone?.replace(/\D/g, '');
    if (!phone) return;
    const firstName = user.name?.split(/\s+/)[0] || 'there';
    try {
      // Only mark as greeted when Meta actually accepted the message, so a
      // failed send (bad template, unverified recipient) retries on the next
      // phone-edit instead of silently locking the user out forever.
      const sent = await this.whatsapp.sendWelcome(phone, firstName);
      if (sent) {
        await this.usersService.update(user.id, { waOnboardedAt: new Date() });
      }
    } catch (e) {
      this.logger.warn(`Onboarding WhatsApp failed: ${(e as Error).message}`);
    }
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
