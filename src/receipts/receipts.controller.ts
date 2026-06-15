import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { DailyQuotaGuard } from '../billing/guards/daily-quota.guard';
import { ReceiptsService } from './receipts.service';
import { CreateReceiptDto } from './dto/create-receipt.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_IMAGES = 6; // sections of one long receipt
const ALLOWED_IMAGE = /^image\/(jpeg|jpg|png|webp|heic)$/;

@ApiTags('receipts')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  // POST /receipts/capture
  @Post('capture')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DailyQuotaGuard) // post-trial Free: 1 upload/day, atomically reserved
  @UseInterceptors(FilesInterceptor('images', MAX_IMAGES))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description:
            'One or more photos. Multiple = sections of one long receipt.',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Capture: upload receipt photo(s), extract fields, return an unsaved draft',
    description:
      'Stores the image(s) and runs OCR/vision extraction. Pass multiple images for a long receipt photographed in sections - they are merged into one receipt. Returns the extracted draft plus an imagePath to echo back when saving. Does NOT persist a receipt.\n\n' +
      'The draft also includes detection flags the client should act on:\n' +
      '- `complete` (boolean): false when the capture looks cut off (no grand total visible).\n' +
      '- `multipleReceipts` (boolean): true when the photo(s) contain 2+ distinct receipts.\n' +
      '- `warning` (string|null): a ready-to-show prompt when `complete=false` or `multipleReceipts=true` (e.g. "are you sure this is the whole receipt?"). Non-blocking — the draft is returned regardless.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Extracted draft (incl. complete / multipleReceipts / warning flags)',
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid image file(s)' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  @ApiResponse({
    status: 402,
    description: 'Free daily upload limit reached - upgrade to Pro',
  })
  @ApiResponse({
    status: 422,
    description:
      'Image is not a receipt - { error: "NOT_A_RECEIPT", message } telling the user to capture a valid receipt',
  })
  capture(
    @CurrentUser() user: User,
    @UploadedFiles() images: Express.Multer.File[],
  ) {
    if (!images?.length) {
      throw new BadRequestException('At least one image is required');
    }
    for (const img of images) {
      if (!ALLOWED_IMAGE.test(img.mimetype)) {
        throw new BadRequestException(
          `Unsupported image type: ${img.mimetype}`,
        );
      }
      if (img.size > MAX_IMAGE_BYTES) {
        throw new BadRequestException('Each image must be 15 MB or smaller');
      }
    }
    return this.receiptsService.capture(user, images);
  }

  // GET /receipts/streak
  @Get('streak')
  @ApiOperation({
    summary: 'Streak summary',
    description:
      'Current + longest snap streak and the last 7 days of snap activity.',
  })
  @ApiResponse({ status: 200, description: 'Streak summary' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  streak(@CurrentUser() user: User) {
    return this.receiptsService.streak(user);
  }

  // POST /receipts
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save a confirmed receipt',
    description:
      'Persists the (possibly user-edited) extracted fields from the capture step and bumps the daily snap streak.',
  })
  @ApiResponse({ status: 201, description: 'Receipt saved' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateReceiptDto) {
    return this.receiptsService.create(user, dto);
  }

  // GET /receipts
  @Get()
  @ApiOperation({
    summary: 'List receipts',
    description:
      'Filter by category, taxEligible, bookmarked, search (merchant), and date range. Paginated, newest first.',
  })
  @ApiResponse({ status: 200, description: 'Paginated receipts' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  list(@CurrentUser() user: User, @Query() query: ListReceiptsQueryDto) {
    return this.receiptsService.list(user, query);
  }

  // GET /receipts/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get a single receipt' })
  @ApiResponse({ status: 200, description: 'Receipt detail' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.receiptsService.findOne(user, id);
  }

  // PATCH /receipts/:id
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a receipt',
    description: 'Edit any field or toggle the bookmark.',
  })
  @ApiResponse({ status: 200, description: 'Updated receipt' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReceiptDto,
  ) {
    return this.receiptsService.update(user, id, dto);
  }

  // DELETE /receipts/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a receipt and its stored image' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Clerk token',
  })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.receiptsService.remove(user, id);
  }
}
