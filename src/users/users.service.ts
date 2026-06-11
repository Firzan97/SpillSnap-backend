import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.repo.findOne({ where: { clerkId } });
  }

  /**
   * Match by phone, comparing digits only so "+60123…" (stored) and "60123…"
   * (WhatsApp wa_id) resolve to the same user.
   */
  async findByPhoneDigits(digits: string): Promise<User | null> {
    const clean = digits.replace(/\D/g, '');
    if (!clean) return null;
    return this.repo
      .createQueryBuilder('u')
      .where("regexp_replace(u.phone, '[^0-9]', '', 'g') = :clean", { clean })
      .getOne();
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  /** Hard-delete the local profile row. Receipts cascade via FK. */
  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
