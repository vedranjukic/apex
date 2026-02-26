import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { ProjectEntity } from './project.entity';
import { MessageEntity } from './message.entity';

@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  title: string;

  @Column({ default: 'idle' })
  status: string; // TaskStatus enum

  @Column({ type: 'text', nullable: true, default: null })
  claudeSessionId: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  mode: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => ProjectEntity, (p) => p.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: ProjectEntity;

  @OneToMany(() => MessageEntity, (m) => m.task)
  messages: MessageEntity[];
}
