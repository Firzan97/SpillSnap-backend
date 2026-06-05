import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicStatsResponseDto } from './dto/public-stats-response.dto';
import { PublicStatsService } from './public-stats.service';

// Public, unauthenticated — the marketing site has no token. No SupabaseAuthGuard.
@ApiTags('public')
@Controller('public/stats')
export class PublicStatsController {
  constructor(private readonly publicStatsService: PublicStatsService) {}

  @Get()
  // Let the CDN/browser cache too, so most landing-page loads never hit Nest.
  @Header('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600')
  @ApiOperation({
    summary: 'Public marketing stats',
    description:
      'Headline counters (receipts, members, free/pro, tax savings) and anonymized top snappers for the landing page. Server-cached and refreshed hourly — fetch once on page load, do not poll.',
  })
  @ApiOkResponse({ type: PublicStatsResponseDto })
  getStats(): Promise<PublicStatsResponseDto> {
    return this.publicStatsService.getStats();
  }
}
