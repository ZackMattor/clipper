import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import path from 'path';
import { Repository } from 'typeorm';
import { ClipRunMetadata, ClipMetadataEntry } from '../lib/clipExtractor';
import { Clip } from '../database/entities/clip.entity';
import { MediaService } from './media.service';
import { ClipRecordDto } from './dto/clip-record.dto';

@Injectable()
export class ClipService {
  private readonly logger = new Logger(ClipService.name);

  constructor(
    @InjectRepository(Clip) private readonly clipRepository: Repository<Clip>,
    private readonly mediaService: MediaService
  ) {}

  async recordRun(metadata: ClipRunMetadata, searchTerm: string): Promise<void> {
    for (const clip of metadata.clips) {
      await this.persistClip(clip, searchTerm, metadata.run_directory);
    }
  }

  async listClips(): Promise<ClipRecordDto[]> {
    const clips = await this.clipRepository.find({
      relations: ['media'],
      order: { createdAt: 'DESC' }
    });
    return clips.map((clip) => ({
      id: clip.id,
      srcMediaId: clip.srcMediaId,
      mediaName: clip.media?.name ?? 'unknown',
      startTimestampMs: clip.startTimestampMs,
      endTimestampMs: clip.endTimestampMs,
      searchTerm: clip.searchTerm,
      subtitleContext: clip.subtitleContext ?? undefined,
      coverFilePath: this.toPublicPath(clip.coverFilePath),
      clipFilePath: this.toPublicPath(clip.clipFilePath) ?? '',
      encodeDurationMs: clip.encodeDurationMs ?? undefined,
      createdAt: clip.createdAt
    }));
  }

  private async persistClip(
    clip: ClipMetadataEntry,
    searchTerm: string,
    runDirectory: string
  ): Promise<void> {
    const folderName = this.extractMediaFolder(clip.video);
    if (!folderName) {
      this.logger.warn(`Unable to determine media folder for clip video path "${clip.video}"`);
      return;
    }
    const media = await this.mediaService.getMediaByName(folderName);
    if (!media) {
      this.logger.warn(`No SrcMedia found for folder "${folderName}", skipping clip persistence`);
      return;
    }
    const entity = this.clipRepository.create({
      srcMediaId: media.id,
      startTimestampMs: Math.round(clip.start * 1000),
      endTimestampMs: Math.round(clip.end * 1000),
      searchTerm,
      subtitleContext: clip.summary_context?.join('\n') ?? null,
      coverFilePath: clip.cover_image ? path.join(runDirectory, clip.cover_image) : null,
      clipFilePath: path.join(runDirectory, clip.file),
      encodeDurationMs: clip.processing_ms ?? null
    });
    await this.clipRepository.save(entity);
  }

  private extractMediaFolder(videoPath: string): string | null {
    const normalized = videoPath.replace(/\\/g, '/');
    const [folder] = normalized.split('/');
    return folder || null;
  }

  private toPublicPath(relative?: string | null): string | undefined {
    if (!relative) {
      return undefined;
    }
    const normalized = relative.replace(/\\/g, '/').replace(/^\/+/, '');
    return `/data/${normalized}`;
  }
}
