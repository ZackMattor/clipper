import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { Repository } from 'typeorm';
import { ClipRunMetadata, ClipMetadataEntry } from '../lib/clipExtractor';
import { Clip } from '../database/entities/clip.entity';
import { MediaService } from './media.service';
import { ClipRecordDto } from './dto/clip-record.dto';

@Injectable()
export class ClipService {
  private readonly logger = new Logger(ClipService.name);
  private readonly dataRoot = path.resolve(process.env.DATA_PATH ?? 'data');
  private readonly dataClipDir = path.join(this.dataRoot, 'clips');
  private readonly dataCoverDir = path.join(this.dataRoot, 'covers');

  constructor(
    @InjectRepository(Clip) private readonly clipRepository: Repository<Clip>,
    private readonly mediaService: MediaService
  ) {}

  async recordRun(
    metadata: ClipRunMetadata,
    searchTerm: string,
    outputRoot: string
  ): Promise<void> {
    await this.ensureDataDirs();
    for (const clip of metadata.clips) {
      await this.persistClip(clip, searchTerm, metadata.run_directory, outputRoot);
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
      summary: clip.summary ?? undefined,
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
    runDirectory: string,
    outputRoot: string
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
    const clipSource = path.join(outputRoot, runDirectory, clip.file);
    if (!(await this.exists(clipSource))) {
      this.logger.warn(`Clip file missing on disk: ${clipSource}`);
      return;
    }
    const storedClipPath = await this.copyAsset(clipSource, this.dataClipDir);

    let storedCoverPath: string | null = null;
    if (clip.cover_image) {
      const coverSource = path.join(outputRoot, runDirectory, clip.cover_image);
      if (await this.exists(coverSource)) {
        storedCoverPath = await this.copyAsset(coverSource, this.dataCoverDir);
      } else {
        this.logger.warn(`Cover file missing on disk: ${coverSource}`);
      }
    }

    const entity = this.clipRepository.create({
      srcMediaId: media.id,
      startTimestampMs: Math.round(clip.start * 1000),
      endTimestampMs: Math.round(clip.end * 1000),
      searchTerm,
      summary: clip.summary ?? null,
      subtitleContext: clip.summary_context?.join('\n') ?? null,
      coverFilePath: storedCoverPath,
      clipFilePath: storedClipPath,
      encodeDurationMs: clip.processing_ms ?? null
    });
    await this.clipRepository.save(entity);
  }

  private extractMediaFolder(videoPath: string): string | null {
    const normalized = videoPath.replace(/\\/g, '/');
    const [folder] = normalized.split('/');
    return folder || null;
  }

  private async ensureDataDirs(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.dataClipDir, { recursive: true }),
      fs.mkdir(this.dataCoverDir, { recursive: true })
    ]);
  }

  private async copyAsset(source: string, destinationDir: string): Promise<string> {
    const ext = path.extname(source) || '';
    const filename = `${randomUUID()}${ext}`;
    const destination = path.join(destinationDir, filename);
    await fs.copyFile(source, destination);
    return path.relative(this.dataRoot, destination);
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private toPublicPath(relative?: string | null): string | undefined {
    if (!relative) {
      return undefined;
    }
    const normalized = relative.replace(/\\/g, '/').replace(/^\/+/, '');
    return `/data/${normalized}`;
  }
}
