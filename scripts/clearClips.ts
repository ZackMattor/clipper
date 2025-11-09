#!/usr/bin/env ts-node
import 'reflect-metadata';
import path from 'path';
import { promises as fs } from 'fs';
import { DataSource } from 'typeorm';
import { Clip } from '../src/database/entities/clip.entity';
import { SrcMedia } from '../src/database/entities/src-media.entity';
import { Subtitle } from '../src/database/entities/subtitle.entity';

async function main(): Promise<void> {
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

  try {
    const total = await clipRepository.count();
    if (!total) {
      console.log('No clips to delete.');
      return;
    }

    await clipRepository.clear();
    console.log(`Deleted ${total} clip${total === 1 ? '' : 's'} from the database.`);

    const dataRoot = path.resolve(process.env.DATA_PATH ?? 'data');
    const clipDir = path.join(dataRoot, 'clips');
    const coverDir = path.join(dataRoot, 'covers');
    await removeDirContents(clipDir);
    await removeDirContents(coverDir);
  } finally {
    await dataSource.destroy();
  }
}

async function removeDirContents(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(entries.map((entry) => fs.rm(path.join(dir, entry), { recursive: true, force: true })));
    console.log(`Cleared ${dir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    console.warn(`Failed to clean ${dir}: ${(error as Error).message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
