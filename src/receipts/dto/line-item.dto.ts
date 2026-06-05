import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class LineItemDto {
  @ApiProperty({ example: 'Quechua Tent 2P' })
  @IsString()
  name: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  qty: number;

  @ApiProperty({ example: 169.0 })
  @IsNumber()
  unitPrice: number;

  @ApiProperty({ example: 169.0 })
  @IsNumber()
  total: number;
}
