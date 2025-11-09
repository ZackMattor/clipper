import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Subtitle } from './subtitle.entity';

export enum SrcMediaStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  READY = 'ready',
  FAILED = 'failed'
}

@Entity({ name: 'src_media' })
export class SrcMedia {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  name!: string;

  @Column({ type: 'text', default: SrcMediaStatus.PENDING })
  status!: SrcMediaStatus;

  @OneToMany(() => Subtitle, (subtitle) => subtitle.media)
  subtitles?: Subtitle[];
}
