import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/register
  @Post('register')
  @ApiOperation({
    summary: 'Register with email + password (proxies Supabase Auth)',
    description:
      'Creates the Supabase user and mirrors the local profile. If email confirmation is enabled, no session is returned until the user confirms (emailConfirmationRequired=true).',
  })
  @ApiResponse({
    status: 201,
    description: 'User created (session if confirmation is off)',
  })
  @ApiResponse({
    status: 400,
    description: 'Weak password / user already exists',
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /auth/login
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in with email + password (proxies Supabase Auth)',
    description:
      'Returns the Supabase access_token + refresh_token and the synced local profile. Use the access_token as the Bearer token for all other endpoints.',
  })
  @ApiResponse({ status: 200, description: 'Session + local profile' })
  @ApiResponse({
    status: 400,
    description: 'Invalid credentials / unconfirmed email',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // POST /auth/forgot-password
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a password-reset email (proxies Supabase recover)',
    description:
      'Always returns 200 regardless of whether the email exists, to avoid leaking which addresses are registered.',
  })
  @ApiResponse({
    status: 200,
    description: 'Reset email sent (if the account exists)',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  // POST /auth/reset-password
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a new password using the recovery token from the reset link',
  })
  @ApiResponse({
    status: 200,
    description: 'Password updated + session/profile',
  })
  @ApiResponse({
    status: 401,
    description: 'Reset link expired or already used',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.accessToken, dto.password);
  }

  // GET /auth/me
  // Sign-up, login, Google SSO, refresh and logout are all handled by
  // Supabase Auth on the client (supabase-js). The client sends the Supabase
  // access token as a Bearer header; this endpoint verifies it, mirrors the
  // user into our DB on first hit, and returns the local profile.
  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify the Supabase token, sync the user, return the profile',
  })
  @ApiResponse({ status: 200, description: 'Local user profile' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Supabase token',
  })
  me(@CurrentUser() user: User) {
    return this.authService.toPublic(user);
  }
}
