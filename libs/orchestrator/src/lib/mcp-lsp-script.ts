/**
 * Returns the JavaScript source for the MCP LSP server that runs
 * INSIDE a Daytona sandbox alongside bridge.js.
 *
 * This is a stdio-based MCP server that the agent (OpenCode) can use to
 * get code intelligence: hover, definition, references, diagnostics, etc.
 *
 * Transport: newline-delimited JSON (JSONL) on stdin/stdout.
 */
export function getMcpLspScript(bridgePort: number): string {
  return `const http = require("http");
const readline = require("readline");
const path = require("path");

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

// ── Language detection ───────────────────────────────

function detectLanguage(filePath) {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const map = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", pyw: "python",
    go: "go",
    rs: "rust",
    java: "java",
  };
  return map[ext] || null;
}

function fileUri(filePath) {
  if (filePath.startsWith("file://")) return filePath;
  return "file://" + (filePath.startsWith("/") ? filePath : path.resolve(filePath));
}

// ── Tool definitions ─────────────────────────────────

const TOOLS = [
  {
    name: "lsp_hover",
    description: "Get hover information (type signature, documentation) for a symbol at a specific position in a file. Use this to understand what a function, variable, or type is before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file" },
        line: { type: "number", description: "Line number (0-based)" },
        character: { type: "number", description: "Column number (0-based)" },
      },
      required: ["file", "line", "character"],
    },
  },
  {
    name: "lsp_definition",
    description: "Go to the definition of a symbol at a specific position. Returns the file path and line where the symbol is defined. Use this to navigate to function/class/type definitions.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file" },
        line: { type: "number", description: "Line number (0-based)" },
        character: { type: "number", description: "Column number (0-based)" },
      },
      required: ["file", "line", "character"],
    },
  },
  {
    name: "lsp_references",
    description: "Find all references to a symbol at a specific position. Returns every location in the codebase where the symbol is used. Use this for impact analysis before refactoring.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file" },
        line: { type: "number", description: "Line number (0-based)" },
        character: { type: "number", description: "Column number (0-based)" },
      },
      required: ["file", "line", "character"],
    },
  },
  {
    name: "lsp_diagnostics",
    description: "Get diagnostics (errors, warnings) for a file from the language server. The file must be opened first (the tool handles this automatically). Use this to check for type errors, syntax issues, etc.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file" },
      },
      required: ["file"],
    },
  },
  {
    name: "lsp_completions",
    description: "Get completion suggestions at a specific position in a file. Returns available symbols, methods, properties that can be used at that location.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file" },
        line: { type: "number", description: "Line number (0-based)" },
        character: { type: "number", description: "Column number (0-based)" },
      },
      required: ["file", "line", "character"],
    },
  },
  {
    name: "lsp_symbols",
    description: "List all symbols (functions, classes, variables, types) defined in a file. Returns a structured outline of the file's contents. Use this to understand file structure before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file" },
      },
      required: ["file"],
    },
  },
];

// ── Diagnostics cache (received via publishDiagnostics) ──

const diagnosticsCache = new Map();

// ── Format helpers ───────────────────────────────────

function formatLocation(loc) {
  if (!loc || !loc.uri) return "(unknown)";
  const fp = loc.uri.replace("file://", "");
  const line = (loc.range && loc.range.start) ? loc.range.start.line + 1 : 0;
  const col = (loc.range && loc.range.start) ? loc.range.start.character + 1 : 0;
  return fp + ":" + line + ":" + col;
}

function formatLocations(locations) {
  if (!locations) return "No results";
  const arr = Array.isArray(locations) ? locations : [locations];
  if (arr.length === 0) return "No results";
  return arr.map(formatLocation).join("\\n");
}

function formatHover(result) {
  if (!result || !result.contents) return "No hover information available";
  const contents = result.contents;
  if (typeof contents === "string") return contents;
  if (contents.value) return contents.value;
  if (Array.isArray(contents)) {
    return contents.map(function(c) {
      return typeof c === "string" ? c : (c.value || "");
    }).join("\\n\\n");
  }
  return JSON.stringify(contents, null, 2);
}

function formatCompletions(result) {
  if (!result) return "No completions";
  const items = result.items || result;
  if (!Array.isArray(items) || items.length === 0) return "No completions";
  const top = items.slice(0, 50);
  return top.map(function(item) {
    const kind = item.kind ? " [" + completionKindName(item.kind) + "]" : "";
    const detail = item.detail ? " — " + item.detail : "";
    return item.label + kind + detail;
  }).join("\\n");
}

function completionKindName(kind) {
  const names = { 1: "Text", 2: "Method", 3: "Function", 4: "Constructor", 5: "Field", 6: "Variable", 7: "Class", 8: "Interface", 9: "Module", 10: "Property", 13: "Enum", 14: "Keyword", 15: "Snippet", 22: "Struct", 25: "TypeParameter" };
  return names[kind] || "Other";
}

function symbolKindName(kind) {
  const names = { 1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class", 6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function", 13: "Variable", 14: "Constant", 23: "Struct", 26: "TypeParameter" };
  return names[kind] || "Symbol";
}

function formatSymbols(result, indent) {
  if (!result || !Array.isArray(result) || result.length === 0) return "No symbols found";
  indent = indent || 0;
  const prefix = "  ".repeat(indent);
  return result.map(function(sym) {
    const kind = sym.kind ? " [" + symbolKindName(sym.kind) + "]" : "";
    const line = sym.range ? ":" + (sym.range.start.line + 1) : "";
    let text = prefix + sym.name + kind + line;
    if (sym.children && sym.children.length > 0) {
      text += "\\n" + formatSymbols(sym.children, indent + 1);
    }
    return text;
  }).join("\\n");
}

function formatDiagnostics(diags) {
  if (!diags || diags.length === 0) return "No diagnostics (clean)";
  return diags.map(function(d) {
    const sev = { 1: "Error", 2: "Warning", 3: "Info", 4: "Hint" }[d.severity] || "Diagnostic";
    const line = d.range ? d.range.start.line + 1 : 0;
    const col = d.range ? d.range.start.character + 1 : 0;
    return sev + " [" + line + ":" + col + "]: " + d.message;
  }).join("\\n");
}

// ── Handle MCP requests ──────────────────────────────

async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "lsp-server", version: "1.0.0" },
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
      if (toolName === "lsp_hover") {
        const uri = fileUri(args.file);
        const lang = detectLanguage(args.file);
        await bridgeRequest("/internal/lsp-notify", {
          language: lang, file: args.file,
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: require("fs").readFileSync(args.file, "utf8") } },
        });
        const resp = await bridgeRequest("/internal/lsp-request", {
          language: lang, file: args.file,
          method: "textDocument/hover",
          params: { textDocument: { uri }, position: { line: args.line, character: args.character } },
        });
        const text = resp.error ? "Error: " + (resp.error.message || JSON.stringify(resp.error)) : formatHover(resp.result);
        sendResponse(id, { content: [{ type: "text", text }] });

      } else if (toolName === "lsp_definition") {
        const uri = fileUri(args.file);
        const lang = detectLanguage(args.file);
        await bridgeRequest("/internal/lsp-notify", {
          language: lang, file: args.file,
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: require("fs").readFileSync(args.file, "utf8") } },
        });
        const resp = await bridgeRequest("/internal/lsp-request", {
          language: lang, file: args.file,
          method: "textDocument/definition",
          params: { textDocument: { uri }, position: { line: args.line, character: args.character } },
        });
        const text = resp.error ? "Error: " + (resp.error.message || JSON.stringify(resp.error)) : formatLocations(resp.result);
        sendResponse(id, { content: [{ type: "text", text }] });

      } else if (toolName === "lsp_references") {
        const uri = fileUri(args.file);
        const lang = detectLanguage(args.file);
        await bridgeRequest("/internal/lsp-notify", {
          language: lang, file: args.file,
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: require("fs").readFileSync(args.file, "utf8") } },
        });
        const resp = await bridgeRequest("/internal/lsp-request", {
          language: lang, file: args.file,
          method: "textDocument/references",
          params: { textDocument: { uri }, position: { line: args.line, character: args.character }, context: { includeDeclaration: true } },
        });
        const text = resp.error ? "Error: " + (resp.error.message || JSON.stringify(resp.error)) : formatLocations(resp.result);
        sendResponse(id, { content: [{ type: "text", text }] });

      } else if (toolName === "lsp_diagnostics") {
        const uri = fileUri(args.file);
        const lang = detectLanguage(args.file);
        await bridgeRequest("/internal/lsp-notify", {
          language: lang, file: args.file,
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: require("fs").readFileSync(args.file, "utf8") } },
        });
        // Wait briefly for the server to compute diagnostics
        await new Promise(r => setTimeout(r, 2000));
        // Request diagnostics via pull model (some servers support it)
        const resp = await bridgeRequest("/internal/lsp-request", {
          language: lang, file: args.file,
          method: "textDocument/diagnostic",
          params: { textDocument: { uri } },
        });
        let text;
        if (resp.error) {
          text = "Diagnostics via pull not supported; use the editor to view live diagnostics.";
        } else {
          const items = (resp.result && resp.result.items) || [];
          text = formatDiagnostics(items);
        }
        sendResponse(id, { content: [{ type: "text", text }] });

      } else if (toolName === "lsp_completions") {
        const uri = fileUri(args.file);
        const lang = detectLanguage(args.file);
        await bridgeRequest("/internal/lsp-notify", {
          language: lang, file: args.file,
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: require("fs").readFileSync(args.file, "utf8") } },
        });
        const resp = await bridgeRequest("/internal/lsp-request", {
          language: lang, file: args.file,
          method: "textDocument/completion",
          params: { textDocument: { uri }, position: { line: args.line, character: args.character } },
        });
        const text = resp.error ? "Error: " + (resp.error.message || JSON.stringify(resp.error)) : formatCompletions(resp.result);
        sendResponse(id, { content: [{ type: "text", text }] });

      } else if (toolName === "lsp_symbols") {
        const uri = fileUri(args.file);
        const lang = detectLanguage(args.file);
        await bridgeRequest("/internal/lsp-notify", {
          language: lang, file: args.file,
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: require("fs").readFileSync(args.file, "utf8") } },
        });
        const resp = await bridgeRequest("/internal/lsp-request", {
          language: lang, file: args.file,
          method: "textDocument/documentSymbol",
          params: { textDocument: { uri } },
        });
        const text = resp.error ? "Error: " + (resp.error.message || JSON.stringify(resp.error)) : formatSymbols(resp.result);
        sendResponse(id, { content: [{ type: "text", text }] });

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
    process.stderr.write("MCP LSP parse error: " + e + "\\n");
  }
});

process.stderr.write("MCP LSP Server ready (bridge port: " + BRIDGE_PORT + ")\\n");
`;
}
