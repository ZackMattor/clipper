import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import path from 'path';
import { ExtractionModule } from './extraction/extraction.module';
import { SrcMedia } from './database/entities/src-media.entity';
import { Subtitle } from './database/entities/subtitle.entity';
import { Clip } from './database/entities/clip.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.SQLITE_PATH ?? path.resolve('subreaderdelux.sqlite'),
      entities: [SrcMedia, Subtitle, Clip],
      synchronize: true
    }),
    ServeStaticModule.forRoot(
      {
        rootPath: path.resolve('clips'),
        serveRoot: '/clips',
        serveStaticOptions: {
          fallthrough: true
        }
      },
      {
        rootPath: path.resolve(process.env.DATA_PATH ?? 'data'),
        serveRoot: '/data',
        serveStaticOptions: {
          fallthrough: true
        }
      }
    ),
    ExtractionModule
  ]
})
export class AppModule {}
