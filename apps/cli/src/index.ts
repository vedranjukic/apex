#!/usr/bin/env bun

import { createProgram } from './commands/index.js';
import chalk from 'chalk';
import { configManager } from './config/index.js';

async function main() {
  try {
    const program = createProgram();
    
    // Check for first-time setup
    const config = configManager.config;
    const hasRequiredKeys = config.anthropicApiKey && config.daytonaApiKey;
    
    // Parse arguments
    await program.parseAsync(process.argv);
    
    // Show setup hint if no API keys configured
    if (!hasRequiredKeys && process.argv.length === 2) {
      console.log();
      console.log(chalk.cyan.bold('  Welcome to Apex CLI!'));
      console.log(chalk.gray('  AI-powered development automation'));
      console.log();
      console.log(chalk.yellow('  Get started:'));
      console.log(chalk.gray('    apex configure                              Set up API keys (first time)'));
      console.log(chalk.gray('    apex run "fix the failing tests"            Ephemeral — run and tear down'));
      console.log(chalk.gray('    apex create my-project                      Create a project + open session'));
      console.log(chalk.gray('    apex open my-project                        Interactive thread session'));
      console.log(chalk.gray('    apex project list                           List all projects'));
      console.log(chalk.gray('    apex dashboard                              Interactive projects overview'));
      console.log();
      console.log(chalk.gray(`  Database: ${config.dbPath}`));
      console.log();
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error:'), error.message);
    } else {
      console.error(chalk.red('Unknown error occurred'));
    }
    process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\nUnexpected error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\nUnhandled promise rejection:'), reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nGracefully shutting down...'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n\nGracefully shutting down...'));
  process.exit(0);
});

if (import.meta.main) {
  main();
}