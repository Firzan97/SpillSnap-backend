import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TagDto {
  @ApiProperty({
    example: '#weekly',
    description: 'Tag name (with or without leading #)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;
}
