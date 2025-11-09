#!/usr/bin/env ts-node
import 'reflect-metadata';
import path from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { parse } from 'yaml';
import { DataSource, Repository } from 'typeorm';
import type { ClipRunMetadata } from '../src/extraction/clip-export.service';
import { Clip } from '../src/database/entities/clip.entity';
import { SrcMedia } from '../src/database/entities/src-media.entity';
import { Subtitle } from '../src/database/entities/subtitle.entity';

async function main(): Promise<void> {
  const outputRoot = path.resolve(process.env.CLIPS_OUTPUT_ROOT ?? 'clips');
  const dataRoot = path.resolve(process.env.DATA_PATH ?? 'data');
  const dataClipDir = path.join(dataRoot, 'clips');
  const dataCoverDir = path.join(dataRoot, 'covers');
  const databasePath = path.resolve(process.env.SQLITE_PATH ?? 'subreaderdelux.sqlite');

  const dataSource = new DataSource({
    type: 'sqlite',
    database: databasePath,
    entities: [Clip, SrcMedia, Subtitle],
    synchronize: false,
    logging: false
  });

  await dataSource.initialize();
  const clipRepository = dataSource.getRepository(Clip);
  const mediaRepository = dataSource.getRepository(SrcMedia);

  try {
    await fs.mkdir(dataClipDir, { recursive: true });
    await fs.mkdir(dataCoverDir, { recursive: true });

    const metadataFiles = await findMetadataFiles(outputRoot);
    if (!metadataFiles.length) {
      console.log(`No metadata.yaml files found under ${outputRoot}. Nothing to import.`);
      return;
    }

    const mediaMap = await buildMediaMap(mediaRepository);
    if (!mediaMap.size) {
      console.log('No SrcMedia rows found. Aborting import.');
      return;
    }

    const existingClipSignatures = new Set(
      (
        await clipRepository.find({
          select: ['srcMediaId', 'startTimestampMs', 'endTimestampMs', 'searchTerm']
        })
      ).map((clip) => buildSignature(clip.srcMediaId, clip.startTimestampMs, clip.endTimestampMs, clip.searchTerm))
    );

    let imported = 0;
    for (const file of metadataFiles) {
      const metadata = await loadMetadata(file);
      if (!metadata) {
        continue;
      }
      for (const clip of metadata.clips) {
        const clipFilePath = path.join(metadata.run_directory, clip.file);
        const startTimestampMs = Math.round(clip.start * 1000);
        const endTimestampMs = Math.round(clip.end * 1000);
        const folderName = extractMediaFolder(clip.video);
        if (!folderName) {
          console.warn(`Skipping clip with unknown folder: ${clip.video}`);
          continue;
        }
        const media = mediaMap.get(folderName);
        if (!media) {
          console.warn(
            `No SrcMedia row found for folder "${folderName}". Run a media sync before importing.`
          );
          continue;
        }
        const signature = buildSignature(media.id, startTimestampMs, endTimestampMs, metadata.query);
        if (existingClipSignatures.has(signature)) {
          continue;
        }
        const absoluteClipSource = path.join(outputRoot, clipFilePath);
        if (!(await exists(absoluteClipSource))) {
          console.warn(`Clip file missing on disk: ${absoluteClipSource}, skipping.`);
          continue;
        }

        const storedClipPath = await copyAsset(
          absoluteClipSource,
          dataClipDir,
          dataRoot
        );

        let storedCoverPath: string | null = null;
        if (clip.cover_image) {
          const absoluteCoverSource = path.join(outputRoot, metadata.run_directory, clip.cover_image);
          if (await exists(absoluteCoverSource)) {
            storedCoverPath = await copyAsset(absoluteCoverSource, dataCoverDir, dataRoot);
          } else {
            console.warn(`Cover file missing on disk: ${absoluteCoverSource}, skipping cover.`);
          }
        }

        const entity = clipRepository.create({
          srcMediaId: media.id,
          startTimestampMs,
          endTimestampMs,
          searchTerm: metadata.query,
          summary: clip.summary ?? null,
          subtitleContext: clip.summary_context?.join('\n') ?? null,
          coverFilePath: storedCoverPath,
          clipFilePath: storedClipPath,
          encodeDurationMs: clip.processing_ms ?? null
        });
        await clipRepository.save(entity);
        existingClipSignatures.add(signature);
        imported += 1;
      }
    }

    console.log(
      imported
        ? `Imported ${imported} clip${imported === 1 ? '' : 's'} into the database.`
        : 'No new clips detected.'
    );
  } finally {
    await dataSource.destroy();
  }
}

async function findMetadataFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  if (!(await exists(root))) {
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

async function loadMetadata(file: string): Promise<ClipRunMetadata | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = parse(raw) as ClipRunMetadata;
    if (!parsed?.clips?.length) {
      console.warn(`Metadata ${file} does not contain any clips.`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn(`Failed to parse ${file}: ${(error as Error).message}`);
    return null;
  }
}

async function buildMediaMap(repository: Repository<SrcMedia>): Promise<Map<string, SrcMedia>> {
  const records = await repository.find();
  const map = new Map<string, SrcMedia>();
  for (const record of records) {
    map.set(record.name, record);
  }
  return map;
}

function extractMediaFolder(videoPath: string): string | null {
  const normalized = videoPath.replace(/\\/g, '/');
  const [folder] = normalized.split('/');
  return folder || null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildSignature(
  mediaId: number,
  start: number,
  end: number,
  searchTerm: string
): string {
  return `${mediaId}:${start}:${end}:${searchTerm}`;
}

async function copyAsset(
  source: string,
  destinationDir: string,
  dataRoot: string
): Promise<string> {
  const ext = path.extname(source);
  const filename = `${randomUUID()}${ext}`;
  await fs.copyFile(source, path.join(destinationDir, filename));
  return path.relative(dataRoot, path.join(destinationDir, filename));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
