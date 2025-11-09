import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import path from 'path';
import { promises as fs, Dirent } from 'fs';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { SrcMedia, SrcMediaStatus } from '../database/entities/src-media.entity';

const SUPPORTED_VIDEO_EXTS = new Set(['.mkv', '.mp4', '.mov', '.m4v']);

export interface MediaEntry {
  id: number;
  name: string;
  status: SrcMediaStatus;
}

export interface MediaListFilters {
  status?: SrcMediaStatus;
}

@Injectable()
export class MediaService implements OnModuleInit {
  readonly mediaRoot = path.resolve(process.env.MEDIA_ROOT ?? 'src_media');

  constructor(
    @InjectRepository(SrcMedia) private readonly mediaRepository: Repository<SrcMedia>
  ) {}

  async onModuleInit(): Promise<void> {
    //await this.syncFilesystemSources();
  }

  async listMedia(filters: MediaListFilters = {}): Promise<MediaEntry[]> {
    const where: FindOptionsWhere<SrcMedia> | undefined = filters.status
      ? { status: filters.status }
      : undefined;
    const records = await this.mediaRepository.find({
      where,
      order: { name: 'ASC' }
    });
    return records.map((record) => ({
      id: record.id,
      name: record.name,
      status: record.status
    }));
  }

  async getMediaById(id: number): Promise<SrcMedia | null> {
    return this.mediaRepository.findOne({ where: { id } });
  }

  async getMediaByName(name: string): Promise<SrcMedia | null> {
    return this.mediaRepository.findOne({ where: { name } });
  }

  async updateStatus(id: number, status: SrcMediaStatus): Promise<void> {
    await this.mediaRepository.update({ id }, { status });
  }

  async getMediaUrl(id: number): Promise<string> {
    const media = await this.getMediaById(id);
    if (!media) {
      throw new Error(`Unknown media id: ${id}`);
    }
    const videoPath = await this.resolvePrimaryVideo(media.name);
    if (!videoPath) {
      throw new Error(`No supported video found for ${media.name}`);
    }
    return path.relative(this.mediaRoot, videoPath);
  }

  private async resolvePrimaryVideo(folderName: string): Promise<string | null> {
    const dirPath = path.join(this.mediaRoot, folderName);
    let stats;
    try {
      stats = await fs.stat(dirPath);
    } catch {
      return null;
    }
    if (!stats.isDirectory()) {
      return null;
    }
    return findPrimaryVideo(dirPath);
  }

  private async syncFilesystemSources(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.mediaRoot, { withFileTypes: true });
    } catch {
      return;
    }
    const folderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (!folderNames.length) {
      return;
    }
    const existing = await this.mediaRepository.find({
      where: { name: In(folderNames) }
    });
    const existingNames = new Set(existing.map((record) => record.name));
    const toInsert = folderNames
      .filter((name) => !existingNames.has(name))
      .map((name) => this.mediaRepository.create({ name }));
    if (toInsert.length) {
      await this.mediaRepository.save(toInsert);
    }
  }
}

async function findPrimaryVideo(dirPath: string): Promise<string | null> {
  const entries = await fs.readdir(dirPath);
  const videos = entries
    .filter((name) => SUPPORTED_VIDEO_EXTS.has(path.extname(name).toLowerCase()))
    .sort();
  if (!videos.length) {
    return null;
  }
  return path.join(dirPath, videos[0]);
}
