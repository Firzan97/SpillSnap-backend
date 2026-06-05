import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { BackfillSummaryDto } from './dto/backfill-summary.dto';
import { ReliefSummaryResponseDto } from './dto/relief-summary-response.dto';
import { UpdateManualReliefsDto } from './dto/update-manual-reliefs.dto';
import { ReliefBackfillService } from './relief-backfill.service';
import { TaxService } from './tax.service';

/** Parse an optional ?ya= string into a valid YA, or undefined. */
function parseYa(ya?: string): number | undefined {
  const parsed = ya ? Number.parseInt(ya, 10) : undefined;
  return parsed != null && Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : undefined;
}

@ApiTags('tax')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('tax')
export class TaxController {
  constructor(
    private readonly tax: TaxService,
    private readonly backfill: ReliefBackfillService,
  ) {}

  @Get('relief-summary')
  @ApiOperation({
    summary: 'LHDN relief progress for a Year of Assessment',
    description:
      'Per-bucket relief spend vs cap (books folded into lifestyle), claimable totals, and the e-Filing deadline. Defaults to the active YA (filing window Jan–Apr → prior year; otherwise the in-progress year). status="provisional" means the YA isn’t finalised yet.',
  })
  @ApiQuery({
    name: 'ya',
    required: false,
    example: 2025,
    description: 'Year of Assessment. Omit to use the active YA.',
  })
  @ApiOkResponse({ type: ReliefSummaryResponseDto })
  getReliefSummary(
    @CurrentUser() user: User,
    @Query('ya') ya?: string,
  ): Promise<ReliefSummaryResponseDto> {
    return this.tax.getReliefSummary(user, parseYa(ya));
  }

  @Patch('manual-reliefs')
  @ApiOperation({
    summary: 'Save optional manual (non-receipt) reliefs for a YA',
    description:
      'Stores user-entered reliefs that no receipt can capture (EPF, life/medical insurance, PRS, SOCSO, SSPN, housing-loan interest, plus disability/spouse/children status). All optional — improves the estimate but can be skipped. Returns the recomputed relief summary.',
  })
  @ApiQuery({ name: 'ya', required: false, example: 2025, description: 'Year of Assessment. Omit to use the active YA.' })
  @ApiOkResponse({ type: ReliefSummaryResponseDto })
  updateManualReliefs(
    @CurrentUser() user: User,
    @Body() dto: UpdateManualReliefsDto,
    @Query('ya') ya?: string,
  ): Promise<ReliefSummaryResponseDto> {
    return this.tax.updateManualReliefs(user, parseYa(ya), dto.values);
  }

  @Post('relief-backfill')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tag past receipts that have no relief category yet',
    description:
      'Finds the user’s confirmed receipts with no relief tag and fills them in — free category→relief map first, then the AI classifier for the rest. Never overwrites a user-set tag; low-confidence guesses are left for the user to confirm. Returns counts of what happened.',
  })
  @ApiOkResponse({ type: BackfillSummaryDto })
  reliefBackfill(@CurrentUser() user: User): Promise<BackfillSummaryDto> {
    return this.backfill.backfillForUser(user);
  }
}
