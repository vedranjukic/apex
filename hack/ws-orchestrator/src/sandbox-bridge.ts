/**
 * Sandbox Bridge - Runs INSIDE the Daytona sandbox
 * 
 * This script:
 * 1. Starts a WebSocket server on port 8080 (exposed via Daytona preview)
 * 2. Waits for the orchestrator to connect
 * 3. Receives prompts from orchestrator
 * 4. Runs Claude CLI and streams responses back
 * 
 * Usage (inside sandbox):
 *   npx tsx sandbox-bridge.ts
 */

import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';

const PORT = parseInt(process.env.BRIDGE_PORT || '8080');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

interface BridgeState {
  ws: WebSocket | null;
  claude: ChildProcess | null;
  sessionId: string;
}

const state: BridgeState = {
  ws: null,
  claude: null,
  sessionId: crypto.randomUUID(),
};

function log(emoji: string, msg: string) {
  console.log(`${new Date().toISOString()} ${emoji} ${msg}`);
}

async function main() {
  log('🚀', `Starting sandbox bridge on port ${PORT}`);

  const wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws) => {
    log('🔗', 'Orchestrator connected');
    state.ws = ws;

    // Send ready message
    ws.send(JSON.stringify({ type: 'bridge_ready', port: PORT, sessionId: state.sessionId }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch (e) {
        log('❌', `Failed to parse message: ${e}`);
      }
    });

    ws.on('close', () => {
      log('🔌', 'Orchestrator disconnected');
      state.ws = null;
      cleanup();
    });

    ws.on('error', (err) => {
      log('❌', `WebSocket error: ${err.message}`);
    });
  });

  wss.on('error', (err) => {
    log('❌', `Server error: ${err.message}`);
  });

  log('✅', `Bridge ready - waiting for orchestrator connection`);
  log('💡', `Preview URL will expose this on port ${PORT}`);
}

function handleMessage(msg: any) {
  switch (msg.type) {
    case 'start_claude':
      startClaude(msg.prompt);
      break;
    case 'stop_claude':
      stopClaude();
      break;
    case 'ping':
      state.ws?.send(JSON.stringify({ type: 'pong' }));
      break;
    default:
      log('⚠️', `Unknown message type: ${msg.type}`);
  }
}

function startClaude(prompt: string) {
  if (state.claude) {
    log('⚠️', 'Claude already running, stopping first');
    stopClaude();
  }

  log('🤖', `Starting Claude with prompt: ${prompt.slice(0, 50)}...`);

  // Write prompt to temp file to avoid shell escaping issues
  const fs = require('fs');
  fs.writeFileSync('/tmp/prompt.txt', prompt);

  // Start Claude with --sdk-url pointing to a local temp server
  // Actually, we'll use stream-json output and parse it
  state.claude = spawn('claude', [
    '--dangerously-skip-permissions',
    '--verbose',
    '--output-format', 'stream-json',
    '-p', prompt,
  ], {
    env: { ...process.env, ANTHROPIC_API_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buffer = '';

  state.claude.stdout?.on('data', (data: Buffer) => {
    buffer += data.toString();
    
    // Process complete JSON lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          // Forward to orchestrator
          state.ws?.send(JSON.stringify({ type: 'claude_message', data: msg }));
          
          // Log progress
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text') {
                log('💬', block.text.slice(0, 60));
              } else if (block.type === 'tool_use') {
                log('🔧', `Tool: ${block.name}`);
              }
            }
          } else if (msg.type === 'result') {
            log('✅', `Completed: ${msg.subtype}`);
          }
        } catch {
          // Not JSON, forward as raw
          state.ws?.send(JSON.stringify({ type: 'claude_raw', data: line }));
        }
      }
    }
  });

  state.claude.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    log('⚠️', `stderr: ${text.slice(0, 100)}`);
    state.ws?.send(JSON.stringify({ type: 'claude_stderr', data: text }));
  });

  state.claude.on('close', (code) => {
    log('🏁', `Claude exited with code ${code}`);
    state.ws?.send(JSON.stringify({ type: 'claude_exit', code }));
    state.claude = null;
  });

  state.claude.on('error', (err) => {
    log('❌', `Claude error: ${err.message}`);
    state.ws?.send(JSON.stringify({ type: 'claude_error', error: err.message }));
  });
}

function stopClaude() {
  if (state.claude) {
    log('⏹️', 'Stopping Claude');
    state.claude.kill('SIGTERM');
    state.claude = null;
  }
}

function cleanup() {
  stopClaude();
}

// Handle process signals
process.on('SIGINT', () => {
  log('👋', 'Shutting down...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('👋', 'Terminated');
  cleanup();
  process.exit(0);
});

main().catch((err) => {
  log('❌', `Fatal error: ${err}`);
  process.exit(1);
});
