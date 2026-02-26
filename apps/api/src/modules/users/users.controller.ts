import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /api/users/me – returns the current (dev) user */
  @Get('me')
  async me() {
    return this.usersService.getCurrentUser();
  }
}
