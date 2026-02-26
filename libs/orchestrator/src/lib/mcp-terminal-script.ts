/**
 * Returns the JavaScript source for the MCP terminal server that runs
 * INSIDE a Daytona sandbox alongside bridge.js.
 *
 * This is a stdio-based MCP server that Claude Code can use to
 * create/manage terminals visible to the user in the dashboard.
 *
 * Transport: newline-delimited JSON (JSONL) on stdin/stdout.
 */
export function getMcpTerminalScript(bridgePort: number): string {
  return `const http = require("http");
const readline = require("readline");

const BRIDGE_PORT = ${bridgePort};

// ── JSON-RPC response helpers ────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

function sendResponse(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── HTTP helper to call bridge ───────────────────────

function bridgeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: "localhost",
      port: BRIDGE_PORT,
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let responseBody = "";
      res.on("data", (c) => responseBody += c);
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve({ raw: responseBody });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function bridgeGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port: BRIDGE_PORT,
      path: path,
      method: "GET",
    }, (res) => {
      let responseBody = "";
      res.on("data", (c) => responseBody += c);
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve({ raw: responseBody });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Tool definitions ─────────────────────────────────

const TOOLS = [
  {
    name: "open_terminal",
    description: "Open a new terminal session visible to the user in the dashboard. Use this to start dev servers, watchers, or any long-running process the user should see. Returns the terminalId for future reference.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the terminal tab, e.g. 'Dev Server', 'Tests'",
        },
        command: {
          type: "string",
          description: "Optional command to run immediately, e.g. 'npm run dev'. If omitted, opens an interactive shell.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the terminal. Defaults to the home directory.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "write_to_terminal",
    description: "Send input to an open terminal session (e.g., to answer a prompt or type a command).",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: {
          type: "string",
          description: "The terminal ID returned by open_terminal",
        },
        input: {
          type: "string",
          description: "Text to send to the terminal stdin. Include a newline for Enter key.",
        },
      },
      required: ["terminalId", "input"],
    },
  },
  {
    name: "read_terminal",
    description: "Read recent output from an open terminal. Use this to check command output, see if a server started, read error messages, etc.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: {
          type: "string",
          description: "The terminal ID to read from",
        },
        lines: {
          type: "number",
          description: "Number of recent scrollback chunks to return. Omit for all available output.",
        },
      },
      required: ["terminalId"],
    },
  },
  {
    name: "list_terminals",
    description: "List all open terminal sessions. Use this to find terminals opened earlier or by other tools.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "close_terminal",
    description: "Close an open terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: {
          type: "string",
          description: "The terminal ID to close",
        },
      },
      required: ["terminalId"],
    },
  },
  {
    name: "get_preview_url",
    description: "Get the public preview URL for a port running in this sandbox. Use this whenever you start a web server or any HTTP service and need to give the user a URL they can open in their browser. The returned URL is publicly accessible — do NOT use localhost links.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "The port number the service is listening on, e.g. 3000, 5173, 8080",
        },
      },
      required: ["port"],
    },
  },
];

// ── Handle MCP requests ──────────────────────────────

async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "terminal-server", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = params && params.name;
    const args = (params && params.arguments) || {};

    try {
      if (toolName === "open_terminal") {
        const result = await bridgeRequest("/internal/terminal-create", {
          name: args.name,
          command: args.command,
          cwd: args.cwd,
        });
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "Error: " + result.error }],
            isError: true,
          });
        } else {
          sendResponse(id, {
            content: [{ type: "text", text: "Terminal opened: " + result.name + " (id: " + result.terminalId + ")" }],
          });
        }

      } else if (toolName === "write_to_terminal") {
        const result = await bridgeRequest("/internal/terminal-write", {
          terminalId: args.terminalId,
          input: args.input,
        });
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "Error: " + result.error }],
            isError: true,
          });
        } else {
          sendResponse(id, {
            content: [{ type: "text", text: "Input sent to terminal " + args.terminalId }],
          });
        }

      } else if (toolName === "read_terminal") {
        const result = await bridgeRequest("/internal/terminal-read", {
          terminalId: args.terminalId,
          lines: args.lines,
        });
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "Error: " + result.error }],
            isError: true,
          });
        } else {
          sendResponse(id, {
            content: [{ type: "text", text: result.output || "(no output yet)" }],
          });
        }

      } else if (toolName === "list_terminals") {
        const result = await bridgeGet("/internal/terminal-list");
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "Error: " + result.error }],
            isError: true,
          });
        } else {
          const list = (result.terminals || []).map(
            (t) => t.id + " - " + t.name
          ).join("\\n") || "(no terminals open)";
          sendResponse(id, {
            content: [{ type: "text", text: list }],
          });
        }

      } else if (toolName === "close_terminal") {
        const result = await bridgeRequest("/internal/terminal-close", {
          terminalId: args.terminalId,
        });
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "Error: " + result.error }],
            isError: true,
          });
        } else {
          sendResponse(id, {
            content: [{ type: "text", text: "Terminal " + args.terminalId + " closed" }],
          });
        }

      } else if (toolName === "get_preview_url") {
        const result = await bridgeRequest("/internal/preview-url", {
          port: args.port,
        });
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "Error: " + result.error }],
            isError: true,
          });
        } else {
          sendResponse(id, {
            content: [{ type: "text", text: result.url }],
          });
        }

      } else {
        sendError(id, -32601, "Unknown tool: " + toolName);
      }
    } catch (e) {
      sendResponse(id, {
        content: [{ type: "text", text: "Error calling bridge: " + e.message }],
        isError: true,
      });
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, "Method not found: " + method);
  }
}

// ── Stdio transport: newline-delimited JSON ──────────

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const request = JSON.parse(trimmed);
    handleRequest(request);
  } catch (e) {
    process.stderr.write("MCP parse error: " + e + "\\n");
  }
});

process.stderr.write("MCP Terminal Server ready (bridge port: " + BRIDGE_PORT + ")\\n");
`;
}
