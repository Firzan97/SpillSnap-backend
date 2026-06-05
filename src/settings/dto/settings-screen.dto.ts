import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Generic settings row. Which fields are present depends on `type`:
 * - value: label, value
 * - input: label, field, value
 * - toggle: label, key, value(boolean)
 * - navigation: label, target
 * - action: label, action, tone
 * - link: label, url
 */
export class SettingsRowDto {
  @ApiProperty({ example: 'face-id' })
  id: string;

  @ApiProperty({
    enum: ['value', 'input', 'toggle', 'navigation', 'action', 'link'],
    example: 'toggle',
  })
  type: string;

  @ApiProperty({ example: 'Face ID unlock' })
  label: string;

  @ApiPropertyOptional({ description: 'Secondary caption' })
  sub?: string;

  @ApiPropertyOptional({
    description: 'value rows: text; toggle rows: boolean; input: current text',
  })
  value?: string | boolean | null;

  @ApiPropertyOptional({ description: 'toggle key (e.g. faceIdUnlock)' })
  key?: string;

  @ApiPropertyOptional({ description: 'input field name (e.g. name, phone)' })
  field?: string;

  @ApiPropertyOptional({ description: 'navigation target screen id' })
  target?: string;

  @ApiPropertyOptional({
    description: 'action id (e.g. signOut, changePassword)',
  })
  action?: string;

  @ApiPropertyOptional({ enum: ['default', 'primary', 'danger'] })
  tone?: string;

  @ApiPropertyOptional({ description: 'link/external url' })
  url?: string;
}

export class SettingsSectionDto {
  @ApiPropertyOptional({ example: 'Security' })
  title?: string;

  @ApiProperty({ type: [SettingsRowDto] })
  rows: SettingsRowDto[];
}

export class SettingsScreenDto {
  @ApiProperty({ example: 'Account & security' })
  title: string;

  @ApiProperty({ type: [SettingsSectionDto] })
  sections: SettingsSectionDto[];
}

export class SettingsIndexMetaDto {
  @ApiProperty({ example: '1.0.0' })
  appVersion: string;
}

export class SettingsIndexDto extends SettingsScreenDto {
  @ApiProperty({ type: SettingsIndexMetaDto })
  meta: SettingsIndexMetaDto;
}
