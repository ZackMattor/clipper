import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { Repository } from 'typeorm';
import { Subtitle } from '../database/entities/subtitle.entity';
import { extractSubtitleTrack } from '../lib/clipExtractor';
import { MediaService } from './media.service';
import { SrcMedia, SrcMediaStatus } from '../database/entities/src-media.entity';

export interface SubtitleEntry {
  startMs: number;
  endMs: number;
  text: string;
}

const ENGLISH_FILE_REGEX = /\.en[g]?\.srt$/i;

@Injectable()
export class SubtitleService {
  private readonly materializedRoot = path.join(os.tmpdir(), 'subreaderdelux-subtitles');

  constructor(
    private readonly mediaService: MediaService,
    @InjectRepository(Subtitle) private readonly subtitleRepository: Repository<Subtitle>
  ) {}

  async getSubtitleEntriesByMedia(id: number): Promise<SubtitleEntry[]> {
    const { raw } = await this.getSubtitleRawContent(id);
    return this.parseSubtitleEntries(raw);
  }

  async getSubtitleRecord(mediaId: number): Promise<Subtitle | null> {
    return this.subtitleRepository.findOne({
      where: { mediaId },
      order: { updatedAt: 'DESC' }
    });
  }

  async getSubtitleRawContent(mediaId: number): Promise<{ subtitle: Subtitle; raw: string }> {
    const subtitle = await this.ensureSubtitleEntity(mediaId);
    if (!subtitle.rawContent) {
      throw new NotFoundException(`No subtitle contents stored for media id ${mediaId}`);
    }
    return { subtitle, raw: subtitle.rawContent };
  }

  async getSubtitleFileFromEntity(mediaId: number): Promise<string> {
    const { subtitle, raw } = await this.getSubtitleRawContent(mediaId);
    if (subtitle.filePath && (await this.exists(subtitle.filePath))) {
      return subtitle.filePath;
    }
    await fs.mkdir(this.materializedRoot, { recursive: true });
    const fallback = path.join(
      this.materializedRoot,
      `media-${mediaId}-subtitle-${subtitle.id}.srt`
    );
    await fs.writeFile(fallback, raw, 'utf8');
    subtitle.filePath = fallback;
    await this.subtitleRepository.save(subtitle);
    return fallback;
  }

  async processMedia(mediaId: number): Promise<Subtitle> {
    const media = await this.mediaService.getMediaById(mediaId);
    if (!media) {
      throw new NotFoundException(`Unknown media id: ${mediaId}`);
    }
    await this.mediaService.updateStatus(mediaId, SrcMediaStatus.IN_PROGRESS);
    try {
      const subtitle = await this.ensureSubtitleEntity(mediaId, media);
      await this.mediaService.updateStatus(mediaId, SrcMediaStatus.READY);
      return subtitle;
    } catch (error) {
      await this.mediaService.updateStatus(mediaId, SrcMediaStatus.FAILED);
      throw error;
    }
  }

  private async ensureSubtitleEntity(mediaId: number, media?: SrcMedia): Promise<Subtitle> {
    const resolvedMedia = media ?? (await this.mediaService.getMediaById(mediaId));
    if (!resolvedMedia) {
      throw new NotFoundException(`Unknown media id: ${mediaId}`);
    }
    let subtitle = await this.getSubtitleRecord(mediaId);
    if (subtitle?.rawContent) {
      return subtitle;
    }

    let sourcePath: string | null = null;
    if (subtitle?.filePath && (await this.exists(subtitle.filePath))) {
      sourcePath = subtitle.filePath;
    }
    if (!sourcePath) {
      const videoRelative = await this.mediaService.getMediaUrl(mediaId);
      const videoPath = path.join(this.mediaService.mediaRoot, videoRelative);
      sourcePath = await this.findSubtitleCandidate(videoPath);
      if (!sourcePath) {
        sourcePath = await this.extractSubtitleFromVideo(videoPath, resolvedMedia.name);
      }
    }
    const rawContent = await fs.readFile(sourcePath, 'utf8');
    subtitle = this.subtitleRepository.create({
      id: subtitle?.id,
      mediaId: resolvedMedia.id,
      filePath: sourcePath,
      rawContent,
      language: inferLanguageFromFilename(sourcePath) ?? subtitle?.language ?? 'eng'
    });
    return this.subtitleRepository.save(subtitle);
  }

  private async findSubtitleCandidate(videoPath: string): Promise<string | null> {
    const directory = path.dirname(videoPath);
    const base = path.join(directory, path.basename(videoPath, path.extname(videoPath)));
    let files: string[] = [];

    try {
      files = await fs.readdir(directory);
    } catch {
      return null;
    }

    const englishMatches = files
      .filter((name) => ENGLISH_FILE_REGEX.test(name) || name.toLowerCase().includes('.eng.'))
      .map((name) => path.join(directory, name));

    const candidates = [
      `${base}.auto.srt`,
      `${base}.auto.en.srt`,
      ...englishMatches,
      `${base}.srt`
    ];

    for (const candidate of candidates) {
      if (await this.exists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async extractSubtitleFromVideo(videoPath: string, mediaName: string): Promise<string> {
    const extracted = await extractSubtitleTrack({
      ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
      videoPath
    });
    if (!extracted) {
      throw new Error(`No subtitles available for ${mediaName}`);
    }
    return extracted;
  }

  private parseSubtitleEntries(contents: string): SubtitleEntry[] {
    const chunks = contents.split(/\r?\n\r?\n/);
    const entries: SubtitleEntry[] = [];

    chunks.forEach((chunk) => {
      const lines = chunk.trim().split(/\r?\n/);
      if (lines.length < 3) {
        return;
      }

      const timing = lines[1];
      const [start, end] = timing.split(' --> ');
      if (!start || !end) {
        return;
      }

      const text = lines.slice(2).join(' ').trim();
      if (!text) {
        return;
      }

      try {
        entries.push({
          startMs: this.parseTimestamp(start),
          endMs: this.parseTimestamp(end),
          text
        });
      } catch {
        // Ignore malformed entries.
      }
    });

    return entries;
  }

  private parseTimestamp(input: string): number {
    const match = input.match(/(\d+):(\d+):(\d+),(\d+)/);
    if (!match) {
      throw new Error(`Invalid timestamp: ${input}`);
    }
    const [, hours, minutes, seconds, millis] = match.map(Number);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds + millis / 1000;
    return Math.round(totalSeconds * 1000);
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }
}

function inferLanguageFromFilename(filePath: string): string | null {
  const lower = path.basename(filePath).toLowerCase();
  if (lower.includes('eng')) {
    return 'eng';
  }
  return null;
}
