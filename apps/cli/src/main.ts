#!/usr/bin/env bun

import { createProgram } from './commands/index.js';
import chalk from 'chalk';

async function main() {
  try {
    const program = createProgram();
    
    // Handle uncaught exceptions gracefully
    process.on('uncaughtException', (error) => {
      console.error(chalk.red('Unexpected error:'), error.message);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error(chalk.red('Unhandled promise rejection:'), reason);
      process.exit(1);
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n👋 Goodbye!'));
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log(chalk.yellow('\n\n👋 Goodbye!'));
      process.exit(0);
    });

    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error:'), error.message);
    } else {
      console.error(chalk.red('Unknown error:'), error);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}