import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ClipMode,
  ContainerFormat,
  HardwareAccel,
  ClipMetadataEntry,
  ClipRunMetadata
} from '../../lib/clipExtractor';
import { SrcMediaStatus } from '../../database/entities/src-media.entity';

export class ExtractClipsDto {
  @ApiProperty({
    description: 'Substring or regex to search for within subtitle text',
    example: 'dino'
  })
  @IsString()
  query!: string;

  @ApiPropertyOptional({
    description: 'Directory that contains movie folders',
    default: 'src_media'
  })
  @IsOptional()
  @IsString()
  mediaRoot?: string;

  @ApiPropertyOptional({
    description: 'Destination directory for generated clips and metadata',
    default: 'clips'
  })
  @IsOptional()
  @IsString()
  outputRoot?: string;

  @ApiPropertyOptional({
    description: 'Treat the query as case sensitive',
    default: false
  })
  @IsOptional()
  @IsBoolean()
  caseSensitive?: boolean;

  @ApiPropertyOptional({
    description: 'Milliseconds of context before/after the detected match',
    default: 300,
    minimum: 0
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30000)
  bufferMs?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of clips to generate',
    minimum: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Only report matches, skip ffmpeg invocation',
    default: false
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Override path to ffmpeg binary',
    default: 'ffmpeg'
  })
  @IsOptional()
  @IsString()
  ffmpegPath?: string;

  @ApiPropertyOptional({
    description: 'Emit ffmpeg -stats progress output',
    default: false
  })
  @IsOptional()
  @IsBoolean()
  ffmpegStats?: boolean;

  @ApiPropertyOptional({
    description: 'Pipes verbose ffmpeg logs (loglevel=info) to the API console',
    default: false
  })
  @IsOptional()
  @IsBoolean()
  ffmpegVerbose?: boolean;

  @ApiProperty({
    description: 'SrcMedia IDs to process',
    type: [Number]
  })
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  srcMedias!: number[];

  @ApiPropertyOptional({
    description: 'Extraction mode',
    enum: ['fast-copy', 'accurate-transcode', 'clean-transcode'],
    default: 'fast-copy'
  })
  @IsOptional()
  @IsEnum(['fast-copy', 'accurate-transcode', 'clean-transcode'])
  mode?: ClipMode;

  @ApiPropertyOptional({
    description: 'Output container format',
    enum: ['mkv', 'mp4'],
    default: 'mkv'
  })
  @IsOptional()
  @IsEnum(['mkv', 'mp4'])
  container?: ContainerFormat;

  @ApiPropertyOptional({
    description: 'Hardware acceleration backend',
    enum: ['videotoolbox']
  })
  @IsOptional()
  @IsEnum(['videotoolbox'])
  hwAccel?: HardwareAccel;
}

export class ClipMetadataEntryDto implements ClipMetadataEntry {
  @ApiProperty({ description: 'Relative path to the generated clip inside the run directory' })
  file!: string;

  @ApiProperty({ description: 'Relative path (from media root) to the source video file' })
  video!: string;

  @ApiProperty({ description: 'Relative path (from media root) to the subtitle file' })
  subtitle!: string;

  @ApiProperty({ description: 'Clip start time in seconds', example: 123.456 })
  start!: number;

  @ApiProperty({ description: 'Clip end time in seconds', example: 124.789 })
  end!: number;

  @ApiProperty({ description: 'Milliseconds spent running ffmpeg for this clip' })
  processing_ms!: number;

  @ApiPropertyOptional({
    description: 'Relative path to the cover image captured at the match timestamp'
  })
  cover_image?: string;

  @ApiPropertyOptional({
    description: 'Brief AI-generated summary of the clip'
  })
  summary?: string;

  @ApiPropertyOptional({
    description: 'Subtitle lines used as LLM context'
  })
  summary_context?: string[];
}

export class ClipRunMetadataDto implements ClipRunMetadata {
  @ApiProperty({ example: 'clip_run.v1' })
  schema!: 'clip_run.v1';

  @ApiProperty()
  query!: string;

  @ApiProperty({ description: 'Buffer on either side of the hit in milliseconds' })
  buffer_ms!: number;

  @ApiProperty({ description: 'ISO timestamp when the run completed' })
  generated_at!: string;

  @ApiProperty({ description: 'Path to the ffmpeg executable that was used' })
  ffmpeg_path!: string;

  @ApiProperty({ enum: ['fast-copy', 'accurate-transcode'] })
  mode!: ClipMode;

  @ApiProperty({ enum: ['mkv', 'mp4'] })
  container!: ContainerFormat;

  @ApiProperty({ enum: ['videotoolbox'], required: false })
  hw_accel?: HardwareAccel;

  @ApiProperty({ description: 'Number of clips generated' })
  total_clips!: number;

  @ApiProperty({ description: 'Run directory (relative to output root)' })
  run_directory!: string;

  @ApiProperty({ type: [ClipMetadataEntryDto] })
  clips!: ClipMetadataEntryDto[];
}

export class ClipIndexEntryDto {
  @ApiProperty({ description: 'Run directory (relative to output root)' })
  run_directory!: string;

  @ApiProperty({ description: 'Query used for this run' })
  query!: string;

  @ApiProperty({ description: 'Buffer in milliseconds added around each hit' })
  buffer_ms!: number;

  @ApiProperty({ description: 'ISO timestamp when the run was generated' })
  generated_at!: string;

  @ApiProperty({ description: 'Path to the ffmpeg binary used' })
  ffmpeg_path!: string;

  @ApiProperty({ enum: ['fast-copy', 'accurate-transcode'] })
  mode!: ClipMode;

  @ApiProperty({ enum: ['mkv', 'mp4'] })
  container!: ContainerFormat;

  @ApiPropertyOptional({ enum: ['videotoolbox'] })
  hw_accel?: HardwareAccel;

  @ApiProperty({ description: 'Clip metadata' })
  clip!: ClipMetadataEntryDto;
}

export class ClipRunCollectionDto {
  @ApiProperty({ type: [ClipRunMetadataDto] })
  runs!: ClipRunMetadataDto[];
}

export class MediaEntryDto {
  @ApiProperty({ description: 'Database identifier' })
  id!: number;

  @ApiProperty({ description: 'Movie folder name' })
  name!: string;

  @ApiProperty({ enum: SrcMediaStatus, description: 'Ingestion status for the media folder' })
  status!: SrcMediaStatus;
}

export class ListMediaQueryDto {
  @ApiPropertyOptional({ enum: SrcMediaStatus, description: 'Filter results by ingestion status' })
  @IsOptional()
  @IsEnum(SrcMediaStatus)
  status?: SrcMediaStatus;
}

export class SubtitleEntryDto {
  @ApiProperty({ description: 'Subtitle start timestamp in milliseconds' })
  startMs!: number;

  @ApiProperty({ description: 'Subtitle end timestamp in milliseconds' })
  endMs!: number;

  @ApiProperty({ description: 'Subtitle text content' })
  text!: string;
}
