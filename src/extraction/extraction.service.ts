import { Injectable, Logger } from '@nestjs/common';
import path from 'path';
import { ClipRunMetadata } from './clip-export.service';
import { ExtractClipsDto } from './dto/extract-clips.dto';
import { MetadataIndexService } from './metadata-index.service';
import { ClipExportService } from './clip-export.service';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  constructor(
    private readonly metadataIndex: MetadataIndexService,
    private readonly clipExportService: ClipExportService
  ) {}

  async extract(dto: ExtractClipsDto): Promise<{ runs: ClipRunMetadata[] }> {
    const targets = dto.srcMedias;
    const runs: ClipRunMetadata[] = [];
    const outputRoot = this.resolveOutputRoot(dto);
    const mediaRoot = dto.mediaRoot ? path.resolve(dto.mediaRoot) : undefined;
    for (const target of targets) {
      this.logger.log(
        `Starting extraction for query="${dto.query}"${target ? ` source="${target}"` : ''}`
      );
      const metadata = await this.clipExportService.run({
        mediaId: target,
        searchTerm: dto.query,
        bufferMs: dto.bufferMs,
        limit: dto.limit,
        caseSensitive: dto.caseSensitive,
        dryRun: dto.dryRun,
        ffmpegPath: dto.ffmpegPath,
        ffmpegStats: dto.ffmpegStats ?? true,
        ffmpegVerbose: dto.ffmpegVerbose ?? false,
        mode: dto.mode,
        container: dto.container,
        mediaRoot,
        outputRoot
      });
      this.logger.log(
        `Completed extraction: ${metadata.total_clips} clip(s) saved to ${metadata.run_directory}`
      );
      this.metadataIndex.addRun(metadata);
      runs.push(metadata);
    }
    return { runs };
  }

  private resolveOutputRoot(dto: ExtractClipsDto): string {
    if (dto.outputRoot) {
      return path.resolve(dto.outputRoot);
    }
    if (process.env.CLIPS_OUTPUT_ROOT) {
      return path.resolve(process.env.CLIPS_OUTPUT_ROOT);
    }
    return path.resolve('clips');
  }
}
