import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { ClipRunMetadata } from '../lib/clipExtractor';
import { ClipIndexEntryDto } from './dto/extract-clips.dto';

@Injectable()
export class MetadataIndexService implements OnModuleInit {
  private readonly logger = new Logger(MetadataIndexService.name);
  private readonly outputRoot = path.resolve(process.env.CLIPS_OUTPUT_ROOT ?? 'clips');
  private runs: ClipRunMetadata[] = [];

  async onModuleInit(): Promise<void> {
    this.runs = await this.loadRunsFromDisk();
    this.logger.log(`Loaded ${this.runs.length} run metadata file(s) into memory`);
  }

  getClipIndex(): ClipIndexEntryDto[] {
    return this.runs.flatMap<ClipIndexEntryDto>((run) =>
      run.clips.map<ClipIndexEntryDto>((clip) => ({
        run_directory: run.run_directory,
        query: run.query,
        buffer_ms: run.buffer_ms,
        generated_at: run.generated_at,
        ffmpeg_path: run.ffmpeg_path,
        mode: run.mode,
        container: run.container,
        hw_accel: run.hw_accel,
        clip: { ...clip }
      }))
    );
  }

  addRun(metadata: ClipRunMetadata): void {
    this.runs = [...this.runs, metadata];
  }

  private async loadRunsFromDisk(): Promise<ClipRunMetadata[]> {
    try {
      const metadataFiles = await this.findMetadataFiles(this.outputRoot);
      const results: ClipRunMetadata[] = [];
      for (const file of metadataFiles) {
        try {
          const raw = await fs.readFile(file, 'utf8');
          const parsed = parse(raw) as ClipRunMetadata;
          if (parsed?.clips) {
            results.push(parsed);
          }
        } catch (error) {
          this.logger.warn(`Failed to parse ${file}: ${(error as Error).message}`);
        }
      }
      return results;
    } catch (error) {
      this.logger.warn(`Unable to scan metadata directory: ${(error as Error).message}`);
      return [];
    }
  }

  private async findMetadataFiles(root: string): Promise<string[]> {
    const results: string[] = [];

    const rootExists = await this.exists(root);
    if (!rootExists) {
      return results;
    }

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase() === 'metadata.yaml') {
          results.push(fullPath);
        }
      }
    };

    await walk(root);
    return results;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
