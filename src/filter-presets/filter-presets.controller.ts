import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { EntitlementService } from '../billing/entitlement.service';
import { assertPro } from '../billing/require-pro';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateFilterPresetDto } from './dto/create-filter-preset.dto';
import { FilterPreset } from './entities/filter-preset.entity';
import { FilterPresetsService } from './filter-presets.service';

@ApiTags('filter-presets')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('filter-presets')
export class FilterPresetsController {
  constructor(
    private readonly presets: FilterPresetsService,
    private readonly entitlements: EntitlementService,
  ) {}

  // GET /filter-presets
  @Get()
  @ApiOperation({ summary: 'List the current user’s saved filter presets' })
  @ApiOkResponse({ type: [FilterPreset] })
  list(@CurrentUser() user: User) {
    return this.presets.list(user.id);
  }

  // POST /filter-presets
  @Post()
  @ApiOperation({ summary: 'Save the current filter combo as a named preset' })
  @ApiCreatedResponse({ type: FilterPreset })
  async create(@CurrentUser() user: User, @Body() dto: CreateFilterPresetDto) {
    assertPro(await this.entitlements.resolve(user), 'Saved filters');
    return this.presets.create(user.id, dto);
  }

  // DELETE /filter-presets/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved filter preset' })
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.presets.remove(user.id, id);
  }
}
