#!/usr/bin/env node
/**
 * MCP Server for Daytona WebSocket Orchestrator
 * 
 * Claude Code calls these tools → WS orchestrator runs parallel tasks → 
 * Live feed streams to stderr → Results returned to Claude
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DaytonaOrchestratorV2 } from './orchestrator-v2.js';
import { TaskDefinition, TaskResult } from './types.js';

// ============================================================================
// STATE
// ============================================================================

let orchestrator: DaytonaOrchestratorV2 | null = null;
let lastResults: TaskResult[] = [];

// ============================================================================
// LIVE FEED → stderr (visible in Claude's terminal)
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const TOOL_ICONS: Record<string, string> = {
  Bash: '⚡', Write: '📝', Edit: '✏️', Read: '👁️',
  TodoWrite: '📋', WebFetch: '🌐', Glob: '📂', Grep: '🔎',
};

function logStderr(msg: string) {
  process.stderr.write(msg + '\n');
}

function formatTime(startTime: number): string {
  const ms = Date.now() - startTime;
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function taskColor(name: string): string {
  if (name.toLowerCase().includes('front')) return COLORS.cyan;
  if (name.toLowerCase().includes('back')) return COLORS.yellow;
  if (name.toLowerCase().includes('test')) return '\x1b[35m'; // magenta
  return COLORS.white;
}

// ============================================================================
// MCP SERVER
// ============================================================================

const server = new Server(
  { name: 'daytona-ws-orchestrator', version: '2.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);

// ============================================================================
// RESOURCES
// ============================================================================

const GUIDE = `# Daytona Parallel Agent Orchestrator

You are an ORCHESTRATOR. When a user asks you to build something, you ALWAYS break it into parallel tasks and run them simultaneously in isolated Daytona sandboxes. Each sandbox has its own Claude Code instance that does the development autonomously. You do NOT write code yourself — you delegate.

## Architecture

User: "Build a todo app"
  → You split into: Frontend + Backend tasks
  → Call run_parallel_tasks([...tasks])
  → Two sandboxes created, two Claude instances work in parallel
  → Live progress streams to terminal
  → Results + preview URLs returned to you
  → Share URLs with user

## The ONE Tool You Need

**run_parallel_tasks** — Creates sandboxes, runs Claude in each, streams live progress, returns results with preview URLs.

## How to Split ANY Request

ALWAYS split into at least Frontend + Backend:

### Backend Task Template
- Express.js REST API in /home/daytona/backend
- Port 3001, CORS enabled for all origins
- In-memory storage with sample data
- Start server and verify with curl

### Frontend Task Template
- Vite + React app in /home/daytona/frontend
- Port 5173, calls backend at http://localhost:3001
- Modern dark theme CSS
- Start dev server with --host 0.0.0.0

## Complete Examples

### User says: "Build a todo app"
\`\`\`json
{
  "tasks": [
    {
      "id": "backend",
      "name": "Backend",
      "prompt": "Create an Express.js REST API in /home/daytona/backend:\\n1. npm init and install express, cors\\n2. Create server.js with endpoints:\\n   - GET /tasks (return all tasks)\\n   - POST /tasks (create task with title, completed fields)\\n   - PUT /tasks/:id (update task)\\n   - DELETE /tasks/:id (delete task)\\n3. In-memory array with 3 sample tasks\\n4. CORS enabled for all origins\\n5. Start on port 3001 and verify with curl"
    },
    {
      "id": "frontend",
      "name": "Frontend",
      "prompt": "Create a React task manager in /home/daytona/frontend:\\n1. Use: npm create vite@latest frontend -- --template react\\n2. Install axios\\n3. Components: TaskList (checkboxes, delete), TaskForm (add new), App (layout)\\n4. Fetch from http://localhost:3001/tasks\\n5. Dark theme, modern CSS\\n6. Start: npm run dev -- --host 0.0.0.0 --port 5173"
    }
  ]
}
\`\`\`

### User says: "Build a chat app"
\`\`\`json
{
  "tasks": [
    {
      "id": "backend",
      "name": "Backend",
      "prompt": "Create Express.js chat API in /home/daytona/backend:\\n1. Endpoints: GET /messages, POST /messages (author, text, timestamp)\\n2. In-memory with sample messages\\n3. CORS, port 3001, start and verify"
    },
    {
      "id": "frontend",
      "name": "Frontend",
      "prompt": "Create React chat UI in /home/daytona/frontend:\\n1. Vite + React\\n2. MessageList with auto-scroll, MessageInput\\n3. Poll http://localhost:3001/messages every 2s\\n4. Chat bubbles UI, dark theme\\n5. Port 5173"
    }
  ]
}
\`\`\`

### User says: "Build a notes app"
\`\`\`json
{
  "tasks": [
    {
      "id": "backend",
      "name": "Backend",
      "prompt": "Create Express.js notes API in /home/daytona/backend:\\n1. CRUD: GET/POST/PUT/DELETE /notes\\n2. Each note: id, title, content, createdAt\\n3. Sample notes, CORS, port 3001"
    },
    {
      "id": "frontend",
      "name": "Frontend",
      "prompt": "Create React notes app in /home/daytona/frontend:\\n1. Vite + React\\n2. Sidebar with note list, main editor area\\n3. Create, edit, delete notes\\n4. Fetch from http://localhost:3001/notes\\n5. Clean dark theme, port 5173"
    }
  ]
}
\`\`\`

## Rules

1. ALWAYS split into frontend + backend tasks (minimum 2)
2. Backend port: 3001, Frontend port: 5173
3. Frontend calls backend at http://localhost:3001
4. Task prompts must say to START the server and VERIFY it works
5. Files go in /home/daytona/{taskname}/ (absolute paths)
6. After completion, share preview URLs with the user
7. Call cleanup_sandboxes when user is done

## Other Tools

- **get_preview_urls** — Get URLs with auth tokens for programmatic access
- **cleanup_sandboxes** — Delete all sandboxes when done
`;

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'daytona://guide/ws-orchestrator',
      name: 'WebSocket Orchestrator Guide',
      description: 'How to use the parallel task orchestrator',
      mimeType: 'text/plain',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
  contents: [
    {
      uri: request.params.uri,
      mimeType: 'text/plain',
      text: GUIDE,
    },
  ],
}));

// ============================================================================
// TOOLS
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_parallel_tasks',
      description:
        'Run multiple development tasks in parallel Daytona sandboxes. ALWAYS read the daytona://guide/ws-orchestrator resource FIRST to learn how to split tasks. Each task gets its own sandbox with its own Claude Code. Live progress streams to terminal. Returns results with preview URLs.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of tasks to run in parallel',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique task ID (e.g., "frontend", "backend")' },
                name: { type: 'string', description: 'Display name (e.g., "Frontend", "Backend")' },
                prompt: { type: 'string', description: 'Detailed task prompt for Claude Code in the sandbox' },
              },
              required: ['id', 'name', 'prompt'],
            },
          },
          timeout_minutes: {
            type: 'number',
            description: 'Max time to wait in minutes (default: 5)',
          },
        },
        required: ['tasks'],
      },
    },
    {
      name: 'get_preview_urls',
      description: 'Get preview URLs with auth tokens for services running in sandboxes. Call after run_parallel_tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          ports: {
            type: 'object',
            description: 'Map of task name to port number, e.g., { "Frontend": 5173, "Backend": 3001 }',
            additionalProperties: { type: 'number' },
          },
        },
        required: ['ports'],
      },
    },
    {
      name: 'cleanup_sandboxes',
      description: 'Delete all sandboxes and free resources. Call when done.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

// ============================================================================
// TOOL HANDLERS
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'run_parallel_tasks': {
      const { tasks, timeout_minutes = 5 } = args as {
        tasks: TaskDefinition[];
        timeout_minutes?: number;
      };

      const startTime = Date.now();
      const taskStats: Map<string, { tools: number; lastMsg: string }> = new Map();

      // Initialize orchestrator
      if (!orchestrator) {
        orchestrator = new DaytonaOrchestratorV2({
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          snapshot: process.env.DAYTONA_SNAPSHOT || 'daytona-claude-l',
          timeoutMs: timeout_minutes * 60 * 1000,
        });
      }

      // Wire up live feed → stderr
      orchestrator.setProgressCallback((session, msg) => {
        const time = formatTime(startTime);
        const color = taskColor(session.taskName);
        const tag = `${color}[${session.taskName}]${COLORS.reset}`;

        if (!taskStats.has(session.taskName)) {
          taskStats.set(session.taskName, { tools: 0, lastMsg: '' });
        }
        const stats = taskStats.get(session.taskName)!;

        if (msg.type === 'bridge_ready') {
          logStderr(`  ${COLORS.gray}${time}${COLORS.reset} ${tag} 🔗 Bridge connected`);
        } else if (msg.type === 'claude_message' && msg.data) {
          const m = msg.data;
          if (m.type === 'system' && m.subtype === 'init') {
            logStderr(`  ${COLORS.gray}${time}${COLORS.reset} ${tag} ⚙️  ${m.model} | ${m.tools?.length || 0} tools`);
          } else if (m.type === 'assistant' && m.message?.content) {
            for (const block of m.message.content) {
              if (block.type === 'text' && block.text?.length > 15) {
                logStderr(`  ${COLORS.gray}${time}${COLORS.reset} ${tag} ${COLORS.white}${block.text.slice(0, 70)}${COLORS.reset}`);
                stats.lastMsg = block.text.slice(0, 40);
              } else if (block.type === 'tool_use') {
                stats.tools++;
                const icon = TOOL_ICONS[block.name] || '🔧';
                const detail = formatToolDetail(block.name, block.input);
                logStderr(`  ${COLORS.gray}${time}${COLORS.reset} ${tag} ${COLORS.yellow}${icon} ${block.name}${detail}${COLORS.reset}`);
                stats.lastMsg = block.name;
              }
            }
          } else if (m.type === 'result') {
            const cost = m.total_cost_usd ? ` $${m.total_cost_usd.toFixed(4)}` : '';
            logStderr(`  ${COLORS.gray}${time}${COLORS.reset} ${tag} ${COLORS.green}🏁 Done (${m.num_turns} turns${cost})${COLORS.reset}`);
          }
        } else if (msg.type === 'claude_exit') {
          const dur = ((Date.now() - startTime) / 1000).toFixed(1);
          const icon = msg.code === 0 ? '✅' : '❌';
          logStderr(`  ${COLORS.gray}${time}${COLORS.reset} ${tag} ${icon} Exited (code: ${msg.code}) after ${dur}s`);
        }
      });

      // Print header
      logStderr('');
      logStderr(`  ${COLORS.bold}╔══════════════════════════════════════════════════════╗${COLORS.reset}`);
      logStderr(`  ${COLORS.bold}║${COLORS.cyan}       LIVE AGENT FEED - Parallel Execution         ${COLORS.reset}${COLORS.bold}║${COLORS.reset}`);
      logStderr(`  ${COLORS.bold}╚══════════════════════════════════════════════════════╝${COLORS.reset}`);
      logStderr('');
      for (const task of tasks) {
        logStderr(`  ${COLORS.gray}  📋 ${task.name}: ${task.prompt.split('\n')[0]}${COLORS.reset}`);
      }
      logStderr('');

      // Start periodic status bar
      const statusInterval = setInterval(() => {
        const time = formatTime(startTime);
        const parts = Array.from(taskStats.entries()).map(([name, s]) => {
          const c = taskColor(name);
          return `${c}${name}${COLORS.reset}: ${s.tools} tools`;
        });
        if (parts.length > 0) {
          logStderr(`  ${COLORS.gray}── ${time} ── ${parts.join(` ${COLORS.gray}│${COLORS.reset} `)} ${COLORS.gray}──${COLORS.reset}`);
        }
      }, 10000);

      try {
        await orchestrator.initialize();

        // Run tasks
        lastResults = await orchestrator.executeTasks(tasks);

        clearInterval(statusInterval);

        // Print summary
        logStderr('');
        logStderr(`  ${COLORS.bold}╔══════════════════════════════════════════════════════╗${COLORS.reset}`);
        logStderr(`  ${COLORS.bold}║${COLORS.green}                   RESULTS                           ${COLORS.reset}${COLORS.bold}║${COLORS.reset}`);
        logStderr(`  ${COLORS.bold}╚══════════════════════════════════════════════════════╝${COLORS.reset}`);
        logStderr('');

        for (const r of lastResults) {
          const icon = r.status === 'success' ? '✅' : '❌';
          const dur = (r.durationMs / 1000).toFixed(1);
          const cost = r.costUsd ? `$${r.costUsd.toFixed(4)}` : '';
          logStderr(`  ${icon} ${r.taskName.padEnd(12)} ${COLORS.gray}${dur}s  ${cost}${COLORS.reset}`);
        }
        logStderr('');

        // Get preview URLs
        const urls: Record<string, string> = {};
        for (const [, session] of orchestrator.getSessions()) {
          const port = session.taskName.toLowerCase().includes('front') ? 5173 : 3001;
          const info = await orchestrator.getPreviewUrl(session.sandboxId, port);
          if (info) {
            urls[session.taskName] = info.url;
            logStderr(`  🔗 ${session.taskName}: ${info.url}`);
          }
        }
        logStderr('');

        // Build response
        const resultText = lastResults.map((r) => {
          const icon = r.status === 'success' ? '✅' : '❌';
          const dur = (r.durationMs / 1000).toFixed(1);
          const cost = r.costUsd ? ` ($${r.costUsd.toFixed(4)})` : '';
          return `${icon} ${r.taskName}: ${r.status} in ${dur}s${cost}`;
        }).join('\n');

        const urlText = Object.entries(urls).map(([name, url]) =>
          `• ${name}: ${url}`
        ).join('\n');

        return {
          content: [{
            type: 'text',
            text: `All tasks completed!\n\n${resultText}\n\nPreview URLs:\n${urlText}\n\nUse get_preview_urls for URLs with auth tokens.`,
          }],
        };

      } catch (err) {
        clearInterval(statusInterval);
        logStderr(`  ${COLORS.red}❌ Error: ${err}${COLORS.reset}`);
        return {
          content: [{ type: 'text', text: `❌ Error: ${err}` }],
          isError: true,
        };
      }
    }

    case 'get_preview_urls': {
      const { ports } = args as { ports: Record<string, number> };

      if (!orchestrator) {
        return {
          content: [{ type: 'text', text: '❌ No orchestrator running. Call run_parallel_tasks first.' }],
          isError: true,
        };
      }

      const results: string[] = [];
      for (const [, session] of orchestrator.getSessions()) {
        const port = ports[session.taskName];
        if (port) {
          const info = await orchestrator.getPreviewUrl(session.sandboxId, port);
          if (info) {
            results.push(`${session.taskName} (port ${port}):\n  URL: ${info.url}\n  Token: ${info.token}`);
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: results.length > 0
            ? `Preview URLs:\n\n${results.join('\n\n')}\n\nUse token in x-daytona-preview-token header.`
            : 'No preview URLs available.',
        }],
      };
    }

    case 'cleanup_sandboxes': {
      if (orchestrator) {
        await orchestrator.cleanup();
        orchestrator = null;
      }
      return {
        content: [{ type: 'text', text: '🧹 All sandboxes deleted.' }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ============================================================================
// HELPERS
// ============================================================================

function formatToolDetail(name: string, input: any): string {
  if (!input) return '';
  if (name === 'Bash') return input.command ? `: ${input.command.slice(0, 40)}` : '';
  if (name === 'Write') return input.file_path ? `: ${input.file_path}` : '';
  if (name === 'Edit') return input.file_path ? `: ${input.file_path}` : '';
  if (name === 'Read') return input.file_path ? `: ${input.file_path}` : '';
  return '';
}

// ============================================================================
// START
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logStderr('🚀 Daytona WS Orchestrator MCP server started');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
