import { Command } from 'commander';
import chalk from 'chalk';
import { configManager } from '../config/index.js';

export function createDashboardCommand(): Command {
  const command = new Command('dashboard')
    .description('Interactive overview of projects and threads')
    .option('--ink', 'Use React/Ink-based TUI (experimental, like OpenCoder)')
    .option('--interactive', 'Use command-line interactive mode')
    .option('--simple', 'Use simple console display')
    .option('--raw', 'Use raw terminal TUI (custom implementation)')
    .action(async (options) => {
      try {
        if (options.ink) {
          // Use experimental React/Ink TUI dashboard
          const config = configManager.config;
          
          // Try to use SQLite database, fall back to mock if it fails
          let db;
          try {
            const { DatabaseManager } = await import('../database/bun-sqlite.js');
            db = new DatabaseManager(config.dbPath);
          } catch (error) {
            console.log(chalk.yellow('⚠ SQLite not available, using mock data'));
            const { MockDatabaseManager } = await import('../database/mock.js');
            db = new MockDatabaseManager(config.dbPath);
          }
          
          try {
            const { startInkTUISimple } = await import('../dashboard/ink-simple.js');
            await startInkTUISimple(db);
          } catch (error) {
            console.log(chalk.red('Ink TUI failed:'), (error as Error).message);
            console.log(chalk.gray('Falling back to blessed dashboard...'));
            const { startBlessedDashboard } = await import('../dashboard/blessed-dashboard.js');
            await startBlessedDashboard(db);
          }
        } else if (options.raw) {
          // Use raw terminal TUI dashboard
          const config = configManager.config;
          
          // Try to use SQLite database, fall back to mock if it fails
          let db;
          try {
            const { DatabaseManager } = await import('../database/bun-sqlite.js');
            db = new DatabaseManager(config.dbPath);
          } catch (error) {
            console.log(chalk.yellow('⚠ SQLite not available, using mock data'));
            const { MockDatabaseManager } = await import('../database/mock.js');
            db = new MockDatabaseManager(config.dbPath);
          }
          
          const { startFullScreenTUI } = await import('../dashboard/tui.js');
          await startFullScreenTUI(db);
        } else if (options.interactive) {
          // Use simple interactive dashboard
          const config = configManager.config;
          
          // Try to use SQLite database, fall back to mock if it fails
          let db;
          try {
            const { DatabaseManager } = await import('../database/bun-sqlite.js');
            db = new DatabaseManager(config.dbPath);
          } catch (error) {
            console.log(chalk.yellow('⚠ SQLite not available, using mock data'));
            const { MockDatabaseManager } = await import('../database/mock.js');
            db = new MockDatabaseManager(config.dbPath);
          }
          
          const { startSimpleDashboard } = await import('../dashboard/simple.js');
          await startSimpleDashboard(db);
        } else if (options.simple) {
          // Use simple console dashboard
          const config = configManager.config;
          
          // Try to use SQLite database, fall back to mock if it fails
          let db;
          try {
            const { DatabaseManager } = await import('../database/bun-sqlite.js');
            db = new DatabaseManager(config.dbPath);
          } catch (error) {
            console.log(chalk.yellow('⚠ SQLite not available, using mock data'));
            const { MockDatabaseManager } = await import('../database/mock.js');
            db = new MockDatabaseManager(config.dbPath);
          }
          
          try {
            console.clear();
            console.log(chalk.cyan.bold('  Apex Dashboard'));
            console.log();
            
            const projects = db.listProjects();
            
            if (projects.length === 0) {
              console.log(chalk.gray('  No projects found.'));
              console.log(chalk.gray('  Create one with: apex project create <name>'));
            } else {
              console.log(chalk.white.bold('Projects'));
              console.log();
              console.log(chalk.gray(`  ${'NAME'.padEnd(20)} ${'STATUS'.padEnd(10)} ${'PROVIDER'.padEnd(12)} CREATED`));
              console.log(chalk.gray('  ' + '─'.repeat(60)));
              
              for (const project of projects) {
                const statusColor = getStatusColor(project.status);
                const formattedDate = formatDate(project.createdAt);
                const threads = db.listThreads(project.id);
                
                console.log(
                  chalk.white(`  ${project.name.padEnd(20)} `) +
                  statusColor(project.status.padEnd(10)) + ' ' +
                  chalk.gray(project.provider.padEnd(12)) + ' ' +
                  chalk.gray(formattedDate) +
                  chalk.gray(` (${threads.length} threads)`)
                );
              }
            }
            
            console.log();
            console.log(chalk.gray('  Use dashboard (no flags) for full TUI, --interactive for command mode'));
            console.log(chalk.gray('  q: quit · h: help'));
            
            db.close();
          } catch (error) {
            db.close();
            throw error;
          }
        } else {
          // Use blessed TUI dashboard by default (stable and feature-rich)
          const config = configManager.config;
          
          // Try to use SQLite database, fall back to mock if it fails
          let db;
          try {
            const { DatabaseManager } = await import('../database/bun-sqlite.js');
            db = new DatabaseManager(config.dbPath);
          } catch (error) {
            console.log(chalk.yellow('⚠ SQLite not available, using mock data'));
            const { MockDatabaseManager } = await import('../database/mock.js');
            db = new MockDatabaseManager(config.dbPath);
          }
          
          const { startBlessedDashboard } = await import('../dashboard/blessed-dashboard.js');
          await startBlessedDashboard(db);
        }
      } catch (error) {
        console.error(chalk.red('Dashboard failed:'), (error as Error).message);
        process.exit(1);
      }
    });

  return command;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'running':
    case 'active':
      return chalk.green;
    case 'creating':
    case 'starting':
      return chalk.yellow;
    case 'completed':
      return chalk.blue;
    case 'stopped':
      return chalk.gray;
    case 'error':
      return chalk.red;
    default:
      return chalk.white;
  }
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit' 
    });
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  }
}

