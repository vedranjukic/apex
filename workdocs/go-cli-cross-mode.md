# Go CLI ↔ Node.js App Cross-Mode

The project has two independent clients that interact with sandboxes:

- `apps/cli` -- Go CLI for terminal-based usage (Cobra, Gorilla WebSocket, Daytona Go SDK)
- `apps/api` -- NestJS backend for the web dashboard

They **never communicate directly**. Both connect to the same bridge (`bridge.js`) running inside each Daytona sandbox over WebSocket (port 8080, exposed via Daytona preview URL).

## Bridge Protocol

JSON messages over WebSocket. Canonical types live in two places that **must stay in sync**:

- **TypeScript (source of truth):** `libs/orchestrator/src/lib/types.ts` -- `BridgeMessage` union, `ClaudeMessage`, `ContentBlock`, terminal/file/layout messages
- **Go (mirror):** `apps/cli/internal/types/types.go` -- `ClaudeOutput`, `ContentBlock`, `BridgeMessage` in `apps/cli/internal/sandbox/bridge.go`

Key message types: `bridge_ready`, `start_claude` (includes optional `agentType` field), `claude_message`, `claude_exit`, `claude_user_answer`, `ask_user_pending`, `ask_user_resolved`, `terminal_create`, `terminal_output`, `file_changed`.

The `start_claude` message now carries an `agentType` field (`claude_code`, `open_code`, or `codex`) that the bridge uses to select the appropriate agent adapter. The wire type name is kept as `start_claude` for backward compatibility.

## Bridge Script Duplication

Both sides generate **identical** JavaScript bridge code uploaded to sandboxes:

- Go: `apps/cli/internal/sandbox/scripts.go` → `GenerateBridgeScript()`
- TypeScript: `libs/orchestrator/src/lib/bridge-script.ts` → `getBridgeScript()`

When modifying the bridge script, update **both** generators and verify they produce equivalent output.

## Build Commands

```bash
# Go CLI
cd apps/cli && go build -o apex ./main.go

# Node.js API (from workspace root)
npm run serve:api        # dev mode
npm run build:api        # production build
```

## Cross-Mode Checklist

When changing the bridge protocol or sandbox interaction:

1. Update TypeScript types in `libs/orchestrator/src/lib/types.ts`
2. Mirror changes in Go types (`apps/cli/internal/types/types.go` and `apps/cli/internal/sandbox/bridge.go`)
3. If bridge script changed, update both `scripts.go` and `bridge-script.ts`
4. If MCP terminal script changed, update both `scripts.go` (`GenerateMCPTerminalScript`) and `mcp-terminal-script.ts`
5. Verify both clients handle new/changed message types

## Ask-User / Waiting-for-Input

When agents need to ask the user a question, they use the MCP `ask_user` tool (native `AskUserQuestion` is disallowed). The bridge emits `ask_user_pending` / `ask_user_resolved` messages. Both clients must handle these:

- **NestJS API:** Gateway sets thread status to `waiting_for_input`, emits `agent_status` via Socket.io. Dashboard shows `AskQuestionBlock`. Guards prevent `result`/`claude_exit` from overwriting `waiting_for_input`.
- **Go CLI TUI:** `ProcessBridgeToDBWithCallbacks` in `bridge.go` handles `ask_user_pending` / `ask_user_resolved`. The TUI uses an `answerCh` channel to send answers from the UI thread to the bridge goroutine (which owns the active manager connection). The TUI tracks `streamingThreadID` (not a boolean) so users can switch between threads while one is streaming.

Status indicators for `waiting_for_input`: CLI uses yellow `?`, dashboard uses yellow `MessageCircleQuestion` icon.
