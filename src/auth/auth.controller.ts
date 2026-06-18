import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { ClerkAuthGuard } from './guards/clerk-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // GET /auth/me
  // Sign-up, login, Google SSO, email verification, password reset, refresh and
  // logout are all handled by Clerk on the client (@clerk/clerk-expo /
  // @clerk/nuxt). The client sends the Clerk session token as a Bearer header;
  // this endpoint verifies it, mirrors the user into our DB on first hit, and
  // returns the local profile.
  @Get('me')
  @UseGuards(ClerkAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Verify the Clerk session token, sync the user, return the profile',
  })
  @ApiResponse({ status: 200, description: 'Local user profile' })
  @ApiResponse({ status: 401, description: 'Missing or invalid Clerk token' })
  me(@CurrentUser() user: User) {
    return this.authService.toPublic(user);
  }
}
