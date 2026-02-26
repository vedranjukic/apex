import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';

/** Well-known default dev user – used until OAuth is wired up. */
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  /** Seed the default dev user on first start. */
  async onModuleInit() {
    const exists = await this.repo.findOneBy({ id: DEFAULT_USER_ID });
    if (!exists) {
      await this.repo.save(
        this.repo.create({
          id: DEFAULT_USER_ID,
          email: 'dev@apex.local',
          name: 'Developer',
          avatarUrl: null,
          oauthProvider: null,
          oauthProviderId: null,
        }),
      );
    }
  }

  /** For now, always return the default dev user. */
  async getCurrentUser(): Promise<UserEntity> {
    return this.repo.findOneByOrFail({ id: DEFAULT_USER_ID });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ email });
  }

  async update(
    id: string,
    data: Partial<Pick<UserEntity, 'name' | 'avatarUrl'>>,
  ): Promise<UserEntity> {
    await this.repo.update(id, data);
    return this.repo.findOneByOrFail({ id });
  }

  getDefaultUserId(): string {
    return DEFAULT_USER_ID;
  }
}
