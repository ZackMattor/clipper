import { Injectable, NotFoundException } from '@nestjs/common';
import path from 'path';
import { ClipRunMetadata, extractClips } from '../lib/clipExtractor';
import { MediaService } from './media.service';
import { SubtitleService } from './subtitle.service';
import { ClipService } from './clip.service';
import { ClipMode, ContainerFormat, HardwareAccel } from '../lib/clipExtractor';

export interface ClipExportOptions {
  mediaId: number;
  searchTerm: string;
  bufferMs?: number;
  limit?: number;
  caseSensitive?: boolean;
  dryRun?: boolean;
  ffmpegPath?: string;
  ffmpegStats?: boolean;
  ffmpegVerbose?: boolean;
  mode?: ClipMode;
  container?: ContainerFormat;
  hwAccel?: HardwareAccel;
  mediaRoot?: string;
  outputRoot?: string;
}

@Injectable()
export class ClipExportService {
  constructor(
    private readonly mediaService: MediaService,
    private readonly subtitleService: SubtitleService,
    private readonly clipService: ClipService
  ) {}

  async run(options: ClipExportOptions): Promise<ClipRunMetadata> {
    const media = await this.mediaService.getMediaById(options.mediaId);
    if (!media) {
      throw new NotFoundException(`Unknown media id: ${options.mediaId}`);
    }

    const subtitlePath = await this.subtitleService.getSubtitleFileFromEntity(media.id);
    const absoluteSubtitle = path.resolve(subtitlePath);
    const videoRelative = await this.mediaService.getMediaUrl(media.id);
    const absoluteVideo = path.resolve(this.mediaService.mediaRoot, videoRelative);
    const outputRoot = options.outputRoot ?? path.resolve(process.env.CLIPS_OUTPUT_ROOT ?? 'clips');

    const metadata = await extractClips({
      query: options.searchTerm,
      bufferMs: options.bufferMs ?? 300,
      limit: options.limit,
      caseSensitive: options.caseSensitive,
      dryRun: options.dryRun,
      ffmpegPath: options.ffmpegPath,
      ffmpegStats: options.ffmpegStats,
      ffmpegVerbose: options.ffmpegVerbose,
      mode: options.mode ?? 'fast-copy',
      container: options.container ?? 'mkv',
      hwAccel: options.hwAccel,
      mediaRoot: options.mediaRoot ?? this.mediaService.mediaRoot,
      outputRoot,
      subtitleFiles: [absoluteSubtitle],
      subtitleVideoMap: { [absoluteSubtitle]: absoluteVideo }
    });

    await this.clipService.recordRun(metadata, options.searchTerm, outputRoot);
    return metadata;
  }
}
