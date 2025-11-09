import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SrcMedia } from '../database/entities/src-media.entity';
import { Subtitle } from '../database/entities/subtitle.entity';
import { Clip } from '../database/entities/clip.entity';
import { ExtractionService } from './extraction.service';
import { ExtractionController } from './extraction.controller';
import { MetadataIndexService } from './metadata-index.service';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { SubtitleService } from './subtitle.service';
import { SrcMediaController } from './src-media.controller';
import { ClipService } from './clip.service';
import { ClipController } from './clip.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SrcMedia, Subtitle, Clip])],
  controllers: [ExtractionController, MediaController, SrcMediaController, ClipController],
  providers: [ExtractionService, MetadataIndexService, MediaService, SubtitleService, ClipService]
})
export class ExtractionModule {}
