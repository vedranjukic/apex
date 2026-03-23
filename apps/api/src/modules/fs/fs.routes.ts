import { Elysia } from 'elysia';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export const fsRoutes = new Elysia({ prefix: '/api/fs' })
  .get('/browse', ({ query }) => {
    const raw = (query as Record<string, string>).path || homedir();
    const dirPath = raw === '~' ? homedir() : raw;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const dirs: DirEntry[] = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          name: e.name,
          path: join(dirPath, e.name),
          isDirectory: true,
        }));

      return { path: dirPath, home: homedir(), entries: dirs };
    } catch (err) {
      return { path: dirPath, home: homedir(), entries: [], error: String(err) };
    }
  });
