import { BadRequestException, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SrcMediaStatus } from '../database/entities/src-media.entity';
import { ListMediaQueryDto, MediaEntryDto } from './dto/extract-clips.dto';
import { MediaService } from './media.service';
import { SubtitleService } from './subtitle.service';

@ApiTags('SrcMedia')
@Controller('api/src_medias')
export class SrcMediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly subtitleService: SubtitleService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List available source media folders' })
  @ApiOkResponse({ type: [MediaEntryDto] })
  @ApiQuery({
    name: 'status',
    enum: SrcMediaStatus,
    required: false,
    description: 'Filter media by ingestion status'
  })
  async list(@Query() query: ListMediaQueryDto): Promise<MediaEntryDto[]> {
    return this.mediaService.listMedia(query);
  }

  @Post(':id/process')
  @ApiOperation({ summary: 'Process a media folder and ingest subtitles' })
  @ApiParam({ name: 'id', description: 'SrcMedia identifier', example: 42 })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        mediaId: { type: 'number' },
        subtitleId: { type: 'number' },
        status: { type: 'string', enum: Object.values(SrcMediaStatus) }
      }
    }
  })
  async process(@Param('id', ParseIntPipe) id: number): Promise<{
    mediaId: number;
    subtitleId: number;
    status: SrcMediaStatus;
  }> {
    const subtitle = await this.subtitleService.processMedia(id);
    return {
      mediaId: id,
      subtitleId: subtitle.id,
      status: SrcMediaStatus.READY
    };
  }

  @Post(':id/fail')
  @ApiOperation({ summary: 'Force mark a ready media item as failed' })
  @ApiParam({ name: 'id', description: 'SrcMedia identifier', example: 42 })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        mediaId: { type: 'number' },
        status: { type: 'string', enum: Object.values(SrcMediaStatus) }
      }
    }
  })
  async markFailed(@Param('id', ParseIntPipe) id: number): Promise<{
    mediaId: number;
    status: SrcMediaStatus;
  }> {
    const media = await this.mediaService.getMediaById(id);
    if (!media) {
      throw new BadRequestException(`Unknown media id: ${id}`);
    }
    if (media.status !== SrcMediaStatus.READY) {
      throw new BadRequestException('Only ready media can be marked as failed');
    }
    await this.mediaService.updateStatus(id, SrcMediaStatus.FAILED);
    return {
      mediaId: id,
      status: SrcMediaStatus.FAILED
    };
  }

  @Get(':id/subtitles/raw')
  @ApiOperation({ summary: 'Retrieve the raw subtitle contents for a media folder' })
  @ApiParam({ name: 'id', description: 'SrcMedia identifier', example: 42 })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        mediaId: { type: 'number' },
        subtitleId: { type: 'number' },
        rawContent: { type: 'string', description: 'Subtitle file contents (SRT)' }
      }
    }
  })
  async getRawSubtitles(@Param('id', ParseIntPipe) id: number): Promise<{
    mediaId: number;
    subtitleId: number;
    rawContent: string;
  }> {
    const { subtitle, raw } = await this.subtitleService.getSubtitleRawContent(id);
    return {
      mediaId: id,
      subtitleId: subtitle.id,
      rawContent: raw
    };
  }
}
