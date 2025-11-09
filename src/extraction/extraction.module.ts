import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SrcMedia } from '../database/entities/src-media.entity';
import { Subtitle } from '../database/entities/subtitle.entity';
import { ExtractionService } from './extraction.service';
import { ExtractionController } from './extraction.controller';
import { MetadataIndexService } from './metadata-index.service';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { SubtitleService } from './subtitle.service';
import { SrcMediaController } from './src-media.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SrcMedia, Subtitle])],
  controllers: [ExtractionController, MediaController, SrcMediaController],
  providers: [ExtractionService, MetadataIndexService, MediaService, SubtitleService]
})
export class ExtractionModule {}
