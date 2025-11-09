import { Injectable, Logger } from '@nestjs/common';
import path from 'path';
import { ClipRunMetadata, extractClips } from '../lib/clipExtractor';
import { ExtractClipsDto } from './dto/extract-clips.dto';
import { MetadataIndexService } from './metadata-index.service';
import { MediaService } from './media.service';
import { SubtitleService } from './subtitle.service';
import { ClipService } from './clip.service';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  constructor(
    private readonly metadataIndex: MetadataIndexService,
    private readonly mediaService: MediaService,
    private readonly subtitleService: SubtitleService,
    private readonly clipService: ClipService
  ) {}

  async extract(dto: ExtractClipsDto): Promise<{ runs: ClipRunMetadata[] }> {
    const targets = dto.srcMedias;
    const runs: ClipRunMetadata[] = [];
    for (const target of targets) {
      const resolution = await this.resolveMediaSelection(target);
      const subtitleFilter = resolution?.subtitles;
      const subtitleMap = resolution?.map ?? {};
      this.logger.log(
        `Starting extraction for query="${dto.query}"${target ? ` source="${target}"` : ''}`
      );
      const metadata = await extractClips({
        ...dto,
        subtitleFiles: subtitleFilter,
        subtitleVideoMap: subtitleMap,
        ffmpegVerbose: dto.ffmpegVerbose ?? false,
        ffmpegStats: dto.ffmpegStats ?? true
      });
      this.logger.log(
        `Completed extraction: ${metadata.total_clips} clip(s) saved to ${metadata.run_directory}`
      );
      this.metadataIndex.addRun(metadata);
      await this.clipService.recordRun(metadata, dto.query);
      runs.push(metadata);
    }
    return { runs };
  }

  private async resolveMediaSelection(
    selection: number
  ): Promise<{ subtitles: string[]; map: Record<string, string> } | undefined> {
    const media = await this.mediaService.getMediaById(selection);
    if (!media) {
      this.logger.warn(`Unknown media selection: ${selection}`);
      return undefined;
    }
    try {
      const subtitlePath = await this.subtitleService.getSubtitleFileFromEntity(selection);
      const absoluteSubtitle = path.resolve(subtitlePath);
      const videoRelative = await this.mediaService.getMediaUrl(selection);
      const absoluteVideo = path.resolve(this.mediaService.mediaRoot, videoRelative);
      return { subtitles: [absoluteSubtitle], map: { [absoluteSubtitle]: absoluteVideo } };
    } catch (error) {
      this.logger.warn(`No subtitles available for ${selection}: ${(error as Error).message}`);
      return undefined;
    }
  }
}
