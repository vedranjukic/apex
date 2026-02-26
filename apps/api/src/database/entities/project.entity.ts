import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { TaskEntity } from './task.entity';

@Entity('projects')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  name: string;

  @Column({ default: '' })
  description: string;

  /** Daytona sandbox ID – null until sandbox is created */
  @Column({ type: 'varchar', nullable: true })
  sandboxId: string | null;

  @Column({ default: '' })
  sandboxSnapshot: string;

  @Column({ default: 'creating' })
  status: string; // ProjectStatus enum

  /** Human-readable error when status === 'error' */
  @Column({ type: 'text', nullable: true, default: null })
  statusError: string | null;

  @Column({ default: 'claude_code' })
  agentType: string; // AgentType enum

  /** Git repository URL to clone into the project folder */
  @Column({ type: 'varchar', nullable: true, default: null })
  gitRepo: string | null;

  /** Agent-specific config (model, snapshot overrides, etc.) */
  @Column({ type: 'simple-json', nullable: true })
  agentConfig: Record<string, unknown> | null;

  /** Points to the root project in a fork family; null for root projects */
  @Column({ type: 'varchar', nullable: true, default: null })
  forkedFromId: string | null;

  /** Git branch checked out in this fork's sandbox */
  @Column({ type: 'varchar', nullable: true, default: null })
  branchName: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Non-null when the user deleted the project but its sandbox couldn't be
   *  removed yet (e.g. it still has fork children).  The record is kept so the
   *  fork family query can discover the orphaned sandbox for later cleanup. */
  @DeleteDateColumn()
  deletedAt: Date | null;

  @ManyToOne(() => UserEntity, (u) => u.projects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @OneToMany(() => TaskEntity, (t) => t.project)
  chats: TaskEntity[];
}
