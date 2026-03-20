import { Elysia } from 'elysia';
import { usersService } from './users.service';

export const usersRoutes = new Elysia({ prefix: '/api/users' })
  .get('/me', () => usersService.getCurrentUser());
