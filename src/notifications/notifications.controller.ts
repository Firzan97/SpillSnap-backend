import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { BroadcastDto } from './dto/broadcast.dto';
import { NotificationsService } from './notifications.service';
import { NotificationsScheduler } from './notifications.scheduler';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly scheduler: NotificationsScheduler,
  ) {}

  // GET /notifications?page=1&limit=30
  @Get()
  @ApiOperation({
    summary:
      'List the current user’s notifications (newest first) + unread count',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Default 1',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Default 30, max 100',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated notifications + unread count',
  })
  list(
    @CurrentUser() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 30));
    return this.notifications.list(user, p, l);
  }

  // POST /notifications/read-all
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 204, description: 'All marked read' })
  markAllRead(@CurrentUser() user: User) {
    return this.notifications.markAllRead(user);
  }

  // POST /notifications/:id/read
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiResponse({ status: 204, description: 'Marked read' })
  markRead(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }

  // POST /notifications/broadcast — admin only: push a product update to everyone.
  @Post('broadcast')
  @ApiOperation({
    summary: 'Broadcast a product update to all opted-in users (admin only)',
  })
  @ApiResponse({ status: 201, description: 'Number of users notified' })
  async broadcast(@CurrentUser() user: User, @Body() dto: BroadcastDto) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admins only.');
    }
    const sent = await this.scheduler.broadcastProductUpdate(
      dto.title,
      dto.body,
    );
    return { sent };
  }
}
