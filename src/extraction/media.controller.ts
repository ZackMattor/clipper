import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SrcMediaStatus } from '../database/entities/src-media.entity';
import { ListMediaQueryDto, MediaEntryDto, SubtitleEntryDto } from './dto/extract-clips.dto';
import { MediaService } from './media.service';
import { SubtitleService } from './subtitle.service';

@ApiTags('Media')
@Controller('api/media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly subtitleService: SubtitleService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List available source media files' })
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

  @Get(':id/subtitles')
  @ApiOperation({ summary: 'Fetch parsed subtitle entries for a media folder' })
  @ApiParam({ name: 'id', description: 'SrcMedia identifier', example: 1 })
  @ApiOkResponse({ type: [SubtitleEntryDto] })
  async getSubtitles(@Param('id', ParseIntPipe) id: number): Promise<SubtitleEntryDto[]> {
    return this.subtitleService.getSubtitleEntriesByMedia(id);
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'Resolve the relative video path for a media folder' })
  @ApiParam({ name: 'id', description: 'SrcMedia identifier', example: 1 })
  @ApiOkResponse({ schema: { type: 'object', properties: { video: { type: 'string' } } } })
  async getMediaUrl(@Param('id', ParseIntPipe) id: number): Promise<{ video: string }> {
    const video = await this.mediaService.getMediaUrl(id);
    return { video };
  }
}
