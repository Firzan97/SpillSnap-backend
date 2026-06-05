import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MergeTagsDto } from './dto/merge-tags.dto';
import { PlatformQueryDto } from './dto/platform-query.dto';
import { SettingsIndexDto, SettingsScreenDto } from './dto/settings-screen.dto';
import { TagDto } from './dto/tag.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { SettingsService } from './settings.service';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const AVATAR_MIME = /^image\/(jpeg|jpg|png|webp|heic)$/;

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // GET /settings
  @Get()
  @ApiOperation({
    summary: 'Settings index (Profile menu)',
    description:
      'Server-driven menu of Settings sub-pages for the active phase, plus app meta. Pass ?platform to gate platform-specific rows.',
  })
  @ApiOkResponse({ type: SettingsIndexDto })
  index(@Query() query: PlatformQueryDto) {
    return this.settings.index(query.platform);
  }

  // GET /settings/help
  @Get('help')
  @ApiOperation({ summary: 'Help & support screen (static config)' })
  @ApiOkResponse({ type: SettingsScreenDto })
  help() {
    return this.settings.help();
  }

  // GET /settings/account
  @Get('account')
  @ApiOperation({
    summary: 'Account & security details',
    description:
      'Identity fields plus a server-driven `sections` config. Face ID is iOS-only — pass ?platform=ios to receive it.',
  })
  @ApiResponse({ status: 200, description: 'Account detail + screen config' })
  account(@CurrentUser() user: User, @Query() query: PlatformQueryDto) {
    return this.settings.account(user, query.platform);
  }

  // PATCH /settings/account
  @Patch('account')
  @ApiOperation({
    summary: 'Update profile / security prefs',
    description: 'Name, phone, Face ID unlock.',
  })
  @ApiResponse({ status: 200, description: 'Updated account' })
  updateAccount(@CurrentUser() user: User, @Body() dto: UpdateAccountDto) {
    return this.settings.updateAccount(user, dto);
  }

  // POST /settings/account/avatar
  @Post('account/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['avatar'],
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
          description: 'Profile photo (jpeg/png/webp/heic, ≤ 5 MB).',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload / replace profile photo',
    description:
      'Stores the image in the public avatar bucket and sets avatarUrl.',
  })
  @ApiResponse({ status: 201, description: 'Updated account' })
  @ApiResponse({ status: 400, description: 'Missing or invalid image' })
  uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() avatar: Express.Multer.File,
  ) {
    if (!avatar) throw new BadRequestException('An image file is required');
    if (!AVATAR_MIME.test(avatar.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type: ${avatar.mimetype}`,
      );
    }
    if (avatar.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Avatar must be 5 MB or smaller');
    }
    return this.settings.updateAvatar(user, avatar);
  }

  // DELETE /settings/account/avatar
  @Delete('account/avatar')
  @ApiOperation({ summary: 'Remove profile photo (revert to initials)' })
  @ApiResponse({ status: 200, description: 'Updated account' })
  removeAvatar(@CurrentUser() user: User) {
    return this.settings.removeAvatar(user);
  }

  // DELETE /settings/account
  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete account',
    description:
      'Permanently deletes the user: removes stored receipt images, the local profile (receipts cascade), and the Supabase Auth user. Irreversible.',
  })
  @ApiResponse({ status: 204, description: 'Account deleted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Supabase token',
  })
  deleteAccount(@CurrentUser() user: User) {
    return this.settings.deleteAccount(user);
  }

  // GET /settings/categories
  @Get('categories')
  @ApiOperation({ summary: 'Categories with receipt counts & totals' })
  @ApiResponse({ status: 200, description: 'Categories' })
  categories(@CurrentUser() user: User) {
    return this.settings.categories(user);
  }

  // GET /settings/tags
  @Get('tags')
  @ApiOperation({
    summary: 'Tags with usage counts (receipt-derived + user-saved)',
  })
  @ApiResponse({ status: 200, description: 'Tags' })
  tags(@CurrentUser() user: User) {
    return this.settings.tags(user);
  }

  // POST /settings/tags
  @Post('tags')
  @ApiOperation({ summary: 'Add a reusable custom tag' })
  @ApiResponse({ status: 201, description: 'Updated tag list' })
  addTag(@CurrentUser() user: User, @Body() dto: TagDto) {
    return this.settings.addTag(user, dto.name);
  }

  // DELETE /settings/tags
  @Delete('tags')
  @ApiOperation({
    summary: 'Remove a saved custom tag (keeps tags already on receipts)',
  })
  @ApiResponse({ status: 200, description: 'Updated tag list' })
  removeTag(@CurrentUser() user: User, @Body() dto: TagDto) {
    return this.settings.removeTag(user, dto.name);
  }

  // POST /settings/tags/merge
  @Post('tags/merge')
  @ApiOperation({
    summary: 'Merge duplicate tags',
    description:
      'Rewrites every receipt using any of the `from` tags to the canonical `into` tag, then drops the merged-away saved tags.',
  })
  @ApiResponse({ status: 201, description: 'Updated tag list' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  mergeTags(@CurrentUser() user: User, @Body() dto: MergeTagsDto) {
    return this.settings.mergeTags(user, dto.from, dto.into);
  }

  // GET /settings/notifications
  @Get('notifications')
  @ApiOperation({ summary: 'Notification preferences' })
  @ApiResponse({ status: 200, description: 'Notification preferences' })
  notifications(@CurrentUser() user: User) {
    return this.settings.notifications(user);
  }

  // PATCH /settings/notifications
  @Patch('notifications')
  @ApiOperation({
    summary: 'Update notification preferences',
    description: 'Channels, per-key toggles, quiet hours.',
  })
  @ApiResponse({ status: 200, description: 'Updated preferences' })
  updateNotifications(
    @CurrentUser() user: User,
    @Body() dto: UpdateNotificationsDto,
  ) {
    return this.settings.updateNotifications(user, dto);
  }
}
