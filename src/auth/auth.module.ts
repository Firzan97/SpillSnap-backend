import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseStrategy } from './strategies/supabase.strategy';

@Module({
  imports: [UsersModule, PassportModule],
  providers: [AuthService, SupabaseStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
