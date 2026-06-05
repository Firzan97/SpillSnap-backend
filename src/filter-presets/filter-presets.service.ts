import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateFilterPresetDto } from './dto/create-filter-preset.dto';
import { FilterPreset } from './entities/filter-preset.entity';

@Injectable()
export class FilterPresetsService {
  constructor(
    @InjectRepository(FilterPreset)
    private readonly repo: Repository<FilterPreset>,
  ) {}

  /** All presets for a user, newest first. */
  list(userId: string): Promise<FilterPreset[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    userId: string,
    dto: CreateFilterPresetDto,
  ): Promise<FilterPreset> {
    const name = dto.name.trim();
    const existing = await this.repo.findOne({ where: { userId, name } });
    if (existing) {
      throw new ConflictException(
        `A filter named "${name}" already exists.`,
      );
    }
    const preset = this.repo.create({
      userId,
      name,
      year: dto.year ?? 'All time',
      categories: dto.categories ?? [],
      tags: dto.tags ?? [],
      bookmarked: dto.bookmarked ?? false,
    });
    return this.repo.save(preset);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException('Filter preset not found.');
    }
  }
}
