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

@Entity({ name: 'clips' })
export class Clip {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => SrcMedia, (media) => media.clips, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'src_media_id' })
  media!: SrcMedia;

  @Column({ name: 'src_media_id' })
  srcMediaId!: number;

  @Column({ name: 'start_timestamp_ms', type: 'integer' })
  startTimestampMs!: number;

  @Column({ name: 'end_timestamp_ms', type: 'integer' })
  endTimestampMs!: number;

  @Column({ name: 'search_term' })
  searchTerm!: string;

  @Column({ name: 'summary', type: 'text', nullable: true })
  summary?: string | null;

  @Column({ name: 'subtitle_context', type: 'text', nullable: true })
  subtitleContext?: string | null;

  @Column({ name: 'cover_file_path', type: 'text', nullable: true })
  coverFilePath?: string | null;

  @Column({ name: 'clip_file_path', type: 'text' })
  clipFilePath!: string;

  @Column({ name: 'encode_duration_ms', type: 'integer', nullable: true })
  encodeDurationMs?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
