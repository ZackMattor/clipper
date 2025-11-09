import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { SrcMedia } from './src-media.entity';

@Entity({ name: 'subtitles' })
export class Subtitle {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  filePath!: string;

  @Column({ type: 'text', nullable: true })
  language?: string | null;

  @ManyToOne(() => SrcMedia, (media) => media.subtitles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'src_media_id' })
  media!: SrcMedia;

  @Column({ name: 'src_media_id' })
  mediaId!: number;

  @Column({ type: 'text', name: 'raw_content', nullable: true })
  rawContent?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
