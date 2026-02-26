import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ProjectEntity } from './project.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  /** e.g. "github", "google" – populated when OAuth is added */
  @Column({ type: 'varchar', nullable: true })
  oauthProvider: string | null;

  /** Provider-specific user ID */
  @Column({ type: 'varchar', nullable: true })
  oauthProviderId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ProjectEntity, (p) => p.user)
  projects: ProjectEntity[];
}
