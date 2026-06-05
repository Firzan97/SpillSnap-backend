import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'ios', enum: ['ios', 'android'], required: false })
  @IsString()
  @IsIn(['ios', 'android'])
  @IsOptional()
  platform?: string;
}
