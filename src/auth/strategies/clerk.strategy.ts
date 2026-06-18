import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService, ClerkJwtPayload } from '../auth.service';

/**
 * Verifies the session token Clerk issues to the client.
 *
 * Clerk signs session tokens with RS256 and publishes the public keys at
 * <issuer>/.well-known/jwks.json. The issuer is the Frontend API URL, e.g.
 * https://your-app.clerk.accounts.dev (dev) or https://clerk.yourdomain.com
 * (production) - set it as CLERK_ISSUER. We verify the signature + issuer + exp;
 * Clerk session tokens carry no audience by default, so none is enforced.
 */
@Injectable()
export class ClerkStrategy extends PassportStrategy(Strategy, 'clerk') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const issuer = config.getOrThrow<string>('CLERK_ISSUER').trim().replace(/\/$/, '');
    // getOrThrow only guards `undefined` — an empty string slips through and
    // produces a broken JWKS URL ("/.well-known/jwks.json"), silently 401ing
    // every request. This bites when an EMPTY CLERK_ISSUER sits in the process
    // env (e.g. a stale pm2 dump or a blank CI secret): dotenv then refuses to
    // load the real value from .env. Fail fast with a clear message instead.
    if (!/^https?:\/\/.+/.test(issuer)) {
      throw new Error(
        `CLERK_ISSUER is missing or invalid ("${issuer}"). Set it to your Clerk ` +
          `Frontend API URL, e.g. https://clerk.spillsnap.com. An empty value in ` +
          `the process env blocks dotenv from loading the .env value.`,
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer,
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `${issuer}/.well-known/jwks.json`,
        cache: true,
        rateLimit: true,
      }),
    });
  }

  async validate(payload: ClerkJwtPayload) {
    if (!payload?.sub) throw new UnauthorizedException('Invalid Clerk token');
    // Mirror the Clerk user into our local table and return the profile.
    return this.authService.syncFromClerk(payload);
  }
}
