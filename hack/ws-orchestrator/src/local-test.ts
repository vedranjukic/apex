/**
 * Local Test: Test the WebSocket protocol with Claude CLI directly
 *
 * This test runs Claude locally (not in Daytona) to verify the protocol works.
 * Useful for development and debugging.
 *
 * Usage:
 *   Terminal 1: npx tsx src/local-test.ts
 *   Terminal 2: claude --sdk-url ws://localhost:9123 --dangerously-skip-permissions
 */

import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import chalk from 'chalk';
import { spawn } from 'child_process';

const PORT = 9123;
const PROMPT = process.argv[2] || 'Say "Hello from WebSocket orchestrator!" in a creative way. One sentence only.';

interface Session {
  id: string;
  ws: WebSocket;
  messages: any[];
  result?: any;
}

const sessions = new Map<string, Session>();

async function main() {
  console.log(chalk.bold.cyan('\n🧪 Local WebSocket Protocol Test\n'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white(`Prompt: ${PROMPT}`));
  console.log(chalk.gray('─'.repeat(50)) + '\n');

  // Start WebSocket server
  const wss = new WebSocketServer({ port: PORT });
  console.log(chalk.green(`✅ WebSocket server listening on ws://localhost:${PORT}\n`));

  wss.on('connection', (ws) => {
    const sessionId = crypto.randomUUID();
    const session: Session = { id: sessionId, ws, messages: [] };
    sessions.set(sessionId, session);

    console.log(chalk.cyan('🔗 Claude connected'));

    // Send user message
    const userMsg = {
      type: 'user',
      message: { role: 'user', content: PROMPT },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
    ws.send(JSON.stringify(userMsg) + '\n');
    console.log(chalk.yellow('📤 Sent prompt to Claude\n'));

    // Handle responses
    ws.on('message', (data: Buffer) => {
      const lines = data.toString().split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          session.messages.push(msg);

          switch (msg.type) {
            case 'system':
              console.log(chalk.gray(`⚙️  System init: ${msg.model} with ${msg.tools?.length || 0} tools`));
              break;

            case 'assistant':
              const content = msg.message?.content || [];
              for (const block of content) {
                if (block.type === 'text') {
                  console.log(chalk.green(`💬 ${block.text}`));
                } else if (block.type === 'tool_use') {
                  console.log(chalk.yellow(`🔧 Tool: ${block.name}`));
                }
              }
              break;

            case 'result':
              session.result = msg;
              console.log(chalk.gray(`\n📊 Result: ${msg.subtype}`));
              console.log(chalk.gray(`   Duration: ${msg.duration_ms}ms`));
              console.log(chalk.gray(`   Cost: $${msg.total_cost_usd?.toFixed(4)}`));
              console.log(chalk.gray(`   Turns: ${msg.num_turns}`));
              break;
          }
        } catch (e) {
          // Not JSON
        }
      }
    });

    ws.on('close', (code) => {
      console.log(chalk.gray(`\n🔌 Claude disconnected (code: ${code})`));

      // Print summary
      console.log(chalk.bold.cyan('\n📋 Session Summary\n'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Messages received: ${session.messages.length}`);
      if (session.result) {
        console.log(`Final result: ${session.result.result}`);
        console.log(`Total cost: $${session.result.total_cost_usd?.toFixed(4)}`);
      }
      console.log(chalk.gray('─'.repeat(50)));

      // Exit after completion
      setTimeout(() => {
        wss.close();
        process.exit(0);
      }, 1000);
    });

    ws.on('error', (err) => {
      console.error(chalk.red(`❌ Error: ${err.message}`));
    });
  });

  // Auto-start Claude CLI
  const autoStart = process.argv.includes('--auto');
  if (autoStart) {
    console.log(chalk.yellow('🤖 Auto-starting Claude CLI...\n'));

    const claude = spawn('claude', ['--sdk-url', `ws://localhost:${PORT}`, '--dangerously-skip-permissions'], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    claude.on('error', (err) => {
      console.error(chalk.red(`Failed to start Claude: ${err.message}`));
    });
  } else {
    console.log(chalk.yellow('💡 Run Claude in another terminal:'));
    console.log(chalk.white(`   claude --sdk-url ws://localhost:${PORT} --dangerously-skip-permissions\n`));
  }
}

main().catch(console.error);
