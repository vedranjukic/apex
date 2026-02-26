#!/usr/bin/env node
/**
 * Quick test: Does stderr from MCP server show up in Claude's terminal?
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'stderr-test', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'test_streaming',
    description: 'Test if stderr streams to terminal while tool is running. Call this to verify.',
    inputSchema: { type: 'object', properties: {} },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => {
  // Simulate long-running task with periodic stderr output
  for (let i = 1; i <= 5; i++) {
    process.stderr.write(`\n  🔄 Step ${i}/5 - Processing... (${new Date().toISOString().split('T')[1].split('.')[0]})\n`);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  process.stderr.write(`\n  ✅ All 5 steps complete!\n\n`);

  return {
    content: [{ type: 'text', text: 'Done! Check if you saw 5 progress updates in the terminal.' }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('🧪 stderr-test MCP server started\n');
}

main().catch(console.error);
