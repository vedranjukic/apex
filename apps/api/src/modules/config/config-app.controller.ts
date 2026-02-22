import { Controller, Get } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';

@Controller('config')
export class ConfigAppController {
  @Get('keybindings')
  async getKeybindings(): Promise<Record<string, string>> {
    try {
      const filePath = join(process.cwd(), 'keybindings.json');
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}
