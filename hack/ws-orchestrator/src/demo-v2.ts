/**
 * Demo V2: WebSocket Orchestrator with Live Stream Feed
 * 
 * Runs parallel Claude instances in Daytona sandboxes and shows
 * a real-time feed of what each agent is doing.
 */

import 'dotenv/config';
import chalk from 'chalk';
import { DaytonaOrchestratorV2 } from './orchestrator-v2.js';
import { LiveFeed } from './live-feed.js';
import { TaskDefinition } from './types.js';

const TASKS: TaskDefinition[] = [
  {
    id: 'frontend',
    name: 'Frontend',
    prompt: `Create a simple React task manager:
1. Use Vite + React in /home/daytona/frontend
2. Create: TaskList, TaskForm, App components
3. Add dark theme styling
4. Start dev server on port 5173
Keep it minimal but functional.`,
  },
  {
    id: 'backend',
    name: 'Backend',
    prompt: `Create an Express API:
1. Initialize in /home/daytona/backend
2. Create REST endpoints: GET/POST/DELETE /tasks
3. Use in-memory storage with sample data
4. Enable CORS, start on port 3001`,
  },
];

async function main() {
  console.log(chalk.bold.cyan('\n  🚀 Daytona Parallel Agent Orchestrator\n'));
  console.log(chalk.gray('  ─'.repeat(29)));
  console.log(chalk.white('  Host → wss:// → Daytona Preview → Sandbox Bridge → Claude'));
  console.log(chalk.gray('  ─'.repeat(29)) + '\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red('  ❌ ANTHROPIC_API_KEY not set in .env'));
    process.exit(1);
  }

  const feed = new LiveFeed();
  const orchestrator = new DaytonaOrchestratorV2({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    snapshot: 'daytona-claude-l',
    timeoutMs: 300000,
  });

  // Wire up live feed to orchestrator progress
  orchestrator.setProgressCallback((session, msg) => {
    feed.onMessage(session.taskName, msg);
  });

  try {
    await orchestrator.initialize();

    console.log(chalk.yellow('  📋 Tasks:'));
    TASKS.forEach((t) => console.log(chalk.gray(`     • ${t.name}: ${t.prompt.split('\n')[0]}`)));
    console.log();

    // Start live feed display
    feed.start();

    const results = await orchestrator.executeTasks(TASKS);

    // Stop live feed
    feed.stop();

    // Print summary
    feed.printSummary(results);

    // Preview URLs
    console.log(chalk.cyan('  🔗 Preview URLs:'));
    for (const [, session] of orchestrator.getSessions()) {
      const port = session.taskName === 'Frontend' ? 5173 : 3001;
      const info = await orchestrator.getPreviewUrl(session.sandboxId, port);
      if (info) {
        console.log(chalk.white(`     ${session.taskName}: ${info.url}`));
        console.log(chalk.gray(`     Token: ${info.token.slice(0, 30)}...`));
      }
    }

    console.log(chalk.yellow('\n  ⚠️  Press Ctrl+C to cleanup and delete sandboxes\n'));
    await new Promise(() => {});

  } catch (err) {
    console.error(chalk.red(`\n  ❌ Error: ${err}`));
  } finally {
    feed.stop();
    await orchestrator.cleanup();
  }
}

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n  🛑 Shutting down...'));
  process.exit(0);
});

main();
