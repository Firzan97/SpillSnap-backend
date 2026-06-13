import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { WhatsappSenderModule } from '../whatsapp/whatsapp-sender.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClerkStrategy } from './strategies/clerk.strategy';

@Module({
  imports: [UsersModule, PassportModule, WhatsappSenderModule],
  providers: [AuthService, ClerkStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
