import { eq } from 'drizzle-orm';
import { db } from '../../database/db';
import { users } from '../../database/schema';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

class UsersService {
  async init() {
    const existing = await db.query.users.findFirst({ where: eq(users.id, DEFAULT_USER_ID) });
    if (!existing) {
      await db.insert(users).values({
        id: DEFAULT_USER_ID,
        email: 'dev@apex.local',
        name: 'Developer',
        avatarUrl: null,
        oauthProvider: null,
        oauthProviderId: null,
      });
    }
  }

  async getCurrentUser() {
    const user = await db.query.users.findFirst({ where: eq(users.id, DEFAULT_USER_ID) });
    if (!user) throw new Error('Default user not found');
    return user;
  }

  async findById(id: string) {
    return db.query.users.findFirst({ where: eq(users.id, id) }) ?? null;
  }

  async findByEmail(email: string) {
    return db.query.users.findFirst({ where: eq(users.email, email) }) ?? null;
  }

  async update(id: string, data: Partial<Pick<typeof users.$inferSelect, 'name' | 'avatarUrl'>>) {
    await db.update(users).set(data).where(eq(users.id, id));
    return this.findById(id);
  }

  getDefaultUserId(): string {
    return DEFAULT_USER_ID;
  }
}

export const usersService = new UsersService();
