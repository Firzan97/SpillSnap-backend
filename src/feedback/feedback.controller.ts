import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicFeedbackResponseDto } from './dto/public-feedback-response.dto';
import { FeedbackService } from './feedback.service';

// Public, unauthenticated - the marketing site has no token. No ClerkAuthGuard.
@ApiTags('public')
@Controller('public/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  // Let the CDN/browser cache too, so most landing-page loads never hit Nest.
  @Header('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600')
  @ApiOperation({
    summary: 'Public testimonials',
    description:
      'Approved customer testimonials for the landing page "Loved by people who hate doing taxes." section. Server-cached and refreshed hourly - fetch once on page load, do not poll. Empty list is valid - the site renders a real empty state, no seed/fake quotes.',
  })
  @ApiOkResponse({ type: PublicFeedbackResponseDto })
  getFeedback(): Promise<PublicFeedbackResponseDto> {
    return this.feedbackService.getPublicFeedback();
  }
}
