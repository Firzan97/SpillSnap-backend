import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { PushService } from './push.service';

@ApiTags('push-tokens')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('push-tokens')
export class PushController {
  constructor(private readonly push: PushService) {}

  // POST /push-tokens - register this device for push.
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register an Expo push token for the current user' })
  register(@CurrentUser() user: User, @Body() dto: RegisterPushTokenDto) {
    return this.push.register(user.id, dto);
  }

  // DELETE /push-tokens/:token - unregister on logout.
  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a push token (e.g. on sign out)' })
  remove(@Param('token') token: string) {
    return this.push.remove(token);
  }
}
