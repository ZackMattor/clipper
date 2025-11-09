import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExtractionService } from './extraction.service';
import { ClipIndexEntryDto, ExtractClipsDto, ClipRunCollectionDto } from './dto/extract-clips.dto';
import { ClipRunMetadata } from '../lib/clipExtractor';
import { MetadataIndexService } from './metadata-index.service';

@ApiTags('Clips')
@Controller('api/clips')
export class ExtractionController {
  constructor(
    private readonly extractionService: ExtractionService,
    private readonly metadataIndex: MetadataIndexService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every generated clip',
    description: 'Returns an index of all clips discovered under the output directory.'
  })
  @ApiOkResponse({
    description: 'Aggregated clip index',
    type: [ClipIndexEntryDto]
  })
  listClips(): ClipIndexEntryDto[] {
    return this.metadataIndex.getClipIndex();
  }

  @Post()
  @ApiOperation({
    summary: 'Extract clips matching a subtitle query',
    description:
      'Searches subtitles for the given query, interpolates the smallest window around each hit, and copies the matching video ranges into the run output directory.'
  })
  @ApiOkResponse({
    description: 'Metadata describing the generated clips',
    type: ClipRunCollectionDto
  })
  extractClips(@Body() dto: ExtractClipsDto): Promise<{ runs: ClipRunMetadata[] }> {
    return this.extractionService.extract(dto);
  }
}
