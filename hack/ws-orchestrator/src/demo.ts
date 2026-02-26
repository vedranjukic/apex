/**
 * Demo: Parallel Full-Stack App Development with Daytona + Claude Code
 *
 * This demo creates a task management app by running Claude Code instances
 * in parallel Daytona sandboxes, coordinated via WebSocket.
 */

import 'dotenv/config';
import chalk from 'chalk';
import { DaytonaWebSocketOrchestrator } from './orchestrator.js';
import { TaskDefinition, SDKMessage, OrchestratorSession } from './types.js';

// Task definitions for parallel execution
const TASKS: TaskDefinition[] = [
  {
    id: 'frontend',
    name: 'Frontend',
    prompt: `Create a modern React task management frontend:
1. Initialize with Vite + React + TypeScript in /home/daytona/frontend
2. Install dependencies: axios for API calls
3. Create components:
   - TaskList: displays tasks with checkboxes
   - TaskForm: add new tasks
   - App: main layout with header
4. Style with modern CSS (use CSS modules or styled-components)
5. Configure to call backend at http://localhost:3001
6. Start dev server on port 5173

Keep it simple but polished. Dark theme preferred.`,
  },
  {
    id: 'backend',
    name: 'Backend',
    prompt: `Create an Express.js REST API for task management:
1. Initialize Node.js project in /home/daytona/backend
2. Install: express, cors, body-parser
3. Create server.js with endpoints:
   - GET /tasks - list all tasks
   - POST /tasks - create task
   - PUT /tasks/:id - update task
   - DELETE /tasks/:id - delete task
4. Use in-memory array for storage
5. Enable CORS for frontend
6. Start server on port 3001

Include sample tasks on startup.`,
  },
];

async function main() {
  console.log(chalk.bold.cyan('\n🚀 Daytona + Claude Code WebSocket Orchestrator Demo\n'));
  console.log(chalk.gray('━'.repeat(60)));
  console.log(chalk.white('Building a full-stack task manager with parallel Claude instances'));
  console.log(chalk.gray('━'.repeat(60)) + '\n');

  // Check environment
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red('❌ ANTHROPIC_API_KEY not set'));
    process.exit(1);
  }

  if (!process.env.HOST_IP) {
    console.log(chalk.yellow('⚠️  HOST_IP not set - cloud sandboxes won\'t be able to connect!'));
    console.log(chalk.gray('   For cloud sandboxes, set HOST_IP to your public IP or ngrok URL:'));
    console.log(chalk.gray('   1. Run: ngrok http 9000'));
    console.log(chalk.gray('   2. Set HOST_IP=your-ngrok-url.ngrok.io in .env'));
    console.log(chalk.gray('   Or use your public IP: HOST_IP=$(curl -s ifconfig.me)\n'));
  }

  // Create orchestrator
  const orchestrator = new DaytonaWebSocketOrchestrator({
    wsPort: 9000,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    snapshot: 'daytona-claude-l', // Pre-installed Claude Code
    timeoutMs: 300000, // 5 minutes
  });

  // Set up real-time progress display
  orchestrator.setProgressCallback((session: OrchestratorSession, msg: SDKMessage) => {
    displayProgress(session, msg);
  });

  try {
    // Initialize
    await orchestrator.initialize();

    console.log(chalk.yellow('\n📋 Tasks to execute:'));
    for (const task of TASKS) {
      console.log(chalk.white(`   • ${task.name}: ${task.prompt.split('\n')[0]}`));
    }
    console.log();

    // Execute tasks in parallel
    console.log(chalk.cyan('⏳ Starting parallel execution...\n'));
    const results = await orchestrator.executeTasks(TASKS);

    // Display results
    console.log(chalk.gray('\n' + '━'.repeat(60)));
    console.log(chalk.bold.green('\n✅ All tasks completed!\n'));

    for (const result of results) {
      const status = result.status === 'success' ? chalk.green('✓') : chalk.red('✗');
      const duration = (result.durationMs / 1000).toFixed(1);
      const cost = result.costUsd ? `$${result.costUsd.toFixed(4)}` : 'N/A';

      console.log(`${status} ${chalk.bold(result.taskName)}`);
      console.log(chalk.gray(`   Duration: ${duration}s | Cost: ${cost}`));
      if (result.error) {
        console.log(chalk.red(`   Error: ${result.error}`));
      }
      console.log();
    }

    // Get preview URLs
    console.log(chalk.cyan('🔗 Preview URLs:'));
    const sessions = orchestrator.getSessions();
    for (const session of sessions.values()) {
      const port = session.taskName === 'Frontend' ? 5173 : 3001;
      const url = await orchestrator.getPreviewUrl(session.sandboxId, port);
      if (url) {
        console.log(chalk.white(`   ${session.taskName}: ${url}`));
      }
    }

    // Prompt for cleanup
    console.log(chalk.yellow('\n⚠️  Sandboxes are still running. Press Ctrl+C to cleanup and exit.\n'));

    // Keep process alive
    await new Promise(() => {}); // Wait forever until Ctrl+C
  } catch (err) {
    console.error(chalk.red(`\n❌ Error: ${err}`));
  } finally {
    await orchestrator.cleanup();
  }
}

/**
 * Display real-time progress
 */
function displayProgress(session: OrchestratorSession, msg: SDKMessage) {
  const prefix = chalk.cyan(`[${session.taskName}]`);

  if (msg.type === 'assistant') {
    const content = (msg as any).message?.content || [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        // Only show significant messages
        const text = block.text.trim();
        if (text.length > 10) {
          console.log(`${prefix} 💬 ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);
        }
      } else if (block.type === 'tool_use') {
        console.log(`${prefix} 🔧 ${chalk.yellow(block.name)}`);
      }
    }
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\n🛑 Shutting down...'));
  process.exit(0);
});

main();
