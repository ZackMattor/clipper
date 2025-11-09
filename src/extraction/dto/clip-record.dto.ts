import { ApiProperty } from '@nestjs/swagger';

export class ClipRecordDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  srcMediaId!: number;

  @ApiProperty()
  mediaName!: string;

  @ApiProperty({ description: 'Clip start timestamp in milliseconds' })
  startTimestampMs!: number;

  @ApiProperty({ description: 'Clip end timestamp in milliseconds' })
  endTimestampMs!: number;

  @ApiProperty({ description: 'Search term that produced this clip' })
  searchTerm!: string;

  @ApiProperty({ required: false, description: 'Subtitle context lines' })
  subtitleContext?: string;

  @ApiProperty({ required: false, description: 'Clip summary' })
  summary?: string;

  @ApiProperty({ required: false, description: 'Relative cover image path' })
  coverFilePath?: string | null;

  @ApiProperty({ description: 'Relative clip file path' })
  clipFilePath!: string;

  @ApiProperty({ required: false, description: 'Milliseconds spent encoding' })
  encodeDurationMs?: number | null;

  @ApiProperty()
  createdAt!: Date;
}
