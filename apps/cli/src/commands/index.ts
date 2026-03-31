import { Command } from 'commander';
import chalk from 'chalk';
import { createConfigureCommand } from './configure.js';
import { createRunCommand } from './run.js';
import { createCreateCommand } from './create.js';
import { createOpenCommand } from './open.js';
import { createCmdCommand } from './cmd.js';
import { createProjectCommand } from './project.js';
import { createDashboardCommand } from './dashboard.js';
import { configManager } from '../config/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('apex')
    .description('Apex CLI - AI-powered development automation')
    .version('0.1.0')
    .option('--db-path <path>', 'Override database path', (path: string) => {
      configManager.setDbPath(path);
    });

  // Let Commander.js handle exits naturally

  // Add commands
  program.addCommand(createConfigureCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createCreateCommand());
  program.addCommand(createOpenCommand());
  program.addCommand(createCmdCommand());
  program.addCommand(createProjectCommand());
  program.addCommand(createDashboardCommand());

  // Error handling
  program.configureOutput({
    writeErr: (str) => process.stderr.write(chalk.red(str)),
  });

  return program;
}

export { createConfigureCommand, createRunCommand, createCreateCommand, createOpenCommand, createCmdCommand, createProjectCommand, createDashboardCommand };