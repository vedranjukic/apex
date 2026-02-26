# Go CLI ↔ Node.js App Cross-Mode

The project has two independent clients that interact with sandboxes:

- `apps/cli` -- Go CLI for terminal-based usage (Cobra, Gorilla WebSocket, Daytona Go SDK)
- `apps/api` -- NestJS backend for the web dashboard

They **never communicate directly**. Both connect to the same bridge (`bridge.js`) running inside each Daytona sandbox over WebSocket (port 8080, exposed via Daytona preview URL).

## Bridge Protocol

JSON messages over WebSocket. Canonical types live in two places that **must stay in sync**:

- **TypeScript (source of truth):** `libs/orchestrator/src/lib/types.ts` -- `BridgeMessage` union, `ClaudeMessage`, `ContentBlock`, terminal/file/layout messages
- **Go (mirror):** `apps/cli/internal/types/types.go` -- `ClaudeOutput`, `ContentBlock`, `BridgeMessage` in `apps/cli/internal/sandbox/bridge.go`

Key message types: `bridge_ready`, `start_claude`, `claude_message`, `claude_exit`, `claude_user_answer`, `terminal_create`, `terminal_output`, `file_changed`.

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
4. Verify both clients handle new/changed message types
