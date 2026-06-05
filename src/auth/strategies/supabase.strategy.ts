import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { decode } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService, SupabaseJwtPayload } from '../auth.service';

/**
 * Verifies the access token Supabase Auth (GoTrue) issues to the client.
 *
 * Supabase now signs access tokens with asymmetric keys (ES256/RS256) and
 * publishes the public keys at <project>/auth/v1/.well-known/jwks.json. Older
 * projects (and some self-hosted ones) still use a symmetric HS256 secret.
 * This strategy supports both: it inspects the token header `alg` and either
 * fetches the matching JWKS public key by `kid` or falls back to
 * SUPABASE_JWT_SECRET for HS256.
 */
@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const baseUrl = config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/(rest\/v1\/?|auth\/v1\/?)?$/, '');
    const hsSecret = config.get<string>('SUPABASE_JWT_SECRET');

    const jwks = new JwksClient({
      jwksUri: `${baseUrl}/auth/v1/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
    });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256', 'HS256'],
      secretOrKeyProvider: (
        _req: unknown,
        rawToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        let header: { alg?: string; kid?: string } | undefined;
        try {
          const decoded = decode(rawToken, { complete: true });
          header =
            decoded && typeof decoded !== 'string' ? decoded.header : undefined;
        } catch {
          header = undefined;
        }
        if (!header?.alg) {
          return done(new Error('Malformed token header'));
        }

        // Symmetric (legacy) — verify with the shared project secret.
        if (header.alg === 'HS256') {
          if (!hsSecret) {
            return done(new Error('SUPABASE_JWT_SECRET is not configured'));
          }
          return done(null, hsSecret);
        }

        // Asymmetric — pull the matching public key from JWKS by `kid`.
        jwks.getSigningKey(header.kid, (err, key) => {
          if (err || !key) {
            return done(err ?? new Error('Signing key not found'));
          }
          done(null, key.getPublicKey());
        });
      },
    });
  }

  async validate(payload: SupabaseJwtPayload) {
    if (!payload?.sub)
      throw new UnauthorizedException('Invalid Supabase token');
    // Mirror the Supabase user into our local table and return the profile.
    return this.authService.syncFromSupabase(payload);
  }
}
