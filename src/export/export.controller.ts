import {
  Body,
  Controller,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { EntitlementService } from '../billing/entitlement.service';
import { assertPro } from '../billing/require-pro';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportSummaryQueryDto } from './dto/export-summary-query.dto';
import { ExportService } from './export.service';

@ApiTags('export')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('export')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly entitlements: EntitlementService,
  ) {}

  // GET /export/summary
  @Get('summary')
  @ApiOperation({
    summary: 'Export summary',
    description:
      'Receipt count + total for the chosen date range. Drives the summary card.',
  })
  @ApiResponse({ status: 200, description: 'Summary' })
  summary(@CurrentUser() user: User, @Query() query: ExportSummaryQueryDto) {
    return this.exportService.summary(user, query);
  }

  // GET /export  (history)
  @Get()
  @ApiOperation({
    summary: 'Recent exports',
    description: 'Metadata for re-downloadable past exports.',
  })
  @ApiResponse({ status: 200, description: 'Recent exports' })
  history(@CurrentUser() user: User) {
    return this.exportService.history(user);
  }

  // POST /export
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate an export',
    description:
      'Builds a CSV from receipts in range with the chosen include options and returns base64 content. Persists reproducible metadata. PDF is not yet implemented.',
  })
  @ApiResponse({ status: 201, description: 'Export content (base64)' })
  @ApiResponse({ status: 501, description: 'PDF not yet implemented' })
  async create(@CurrentUser() user: User, @Body() dto: CreateExportDto) {
    // Plain (full / date-range) CSV export stays free. Narrowing by category or
    // tag — i.e. exporting a saved filter/bookmark — is Pro-only.
    if (dto.categories?.length || dto.tags?.length) {
      assertPro(await this.entitlements.resolve(user), 'Filtered export');
    }
    return this.exportService.create(user, dto);
  }

  // GET /export/:id/download
  @Get(':id/download')
  @ApiOperation({
    summary: 'Re-download a past export',
    description: 'Regenerates from saved parameters.',
  })
  @ApiResponse({ status: 200, description: 'Export content (base64)' })
  @ApiResponse({ status: 404, description: 'Export not found' })
  download(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.exportService.download(user, id);
  }
}
