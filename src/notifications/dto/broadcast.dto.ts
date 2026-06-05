import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BroadcastDto {
  @ApiProperty({ example: 'New: bulk export' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title: string;

  @ApiProperty({ example: 'You can now export a year of receipts in one tap.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  body: string;
}
