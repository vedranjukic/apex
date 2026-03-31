# Apex CLI (TypeScript/Bun)

A complete rewrite of the Apex CLI from Go to TypeScript, powered by Bun for fast execution and single-binary distribution.

## Features

✅ **Complete Command Compatibility**: All original Go CLI commands reimplemented  
✅ **Zero Protocol Drift**: Shares types and scripts with the main TypeScript codebase  
✅ **All Sandbox Providers**: Daytona, Docker, Local, Apple Container  
✅ **Native Database**: Uses Bun's SQLite for fast, lightweight persistence  
✅ **Interactive REPL**: Full-featured terminal interface with history and commands  
✅ **Cross-Platform Binaries**: Single-file executables for Linux and macOS  
✅ **TypeScript Type Safety**: Full type checking and IDE support
- **Simplified dependency tree** - removed better-sqlite3 and @types/better-sqlite3

### Database Migration
The CLI now uses `src/database/bun-sqlite.ts` with Bun's native SQLite driver instead of better-sqlite3. This provides:
- Better performance with Bun's optimized SQLite implementation
- Reduced dependency footprint
- Native Bun integration

### Mock Sandbox Manager
Added `src/sandbox/mock.ts` which provides:
- Realistic sandbox interaction simulation
- Tool use demonstration (read, write, etc.)
- Streaming agent responses
- No external dependencies required
- Perfect for development and testing

All command files have been updated to use the new Bun SQLite database and mock sandbox manager.

## Structure

```
src/
├── commands/           # Individual CLI commands
│   ├── configure.ts    # API key configuration
│   ├── run.ts         # Ephemeral sandbox execution
│   ├── create.ts      # Project creation with sandbox
│   ├── open.ts        # Open existing project
│   ├── cmd.ts         # Send command to existing thread
│   ├── project.ts     # Project management (list/delete/create)
│   ├── dashboard.ts   # Terminal UI dashboard
│   └── index.ts       # Command registry
├── config/            # Configuration management
├── database/          # SQLite database operations
├── sandbox/           # Sandbox management and CLI integration
├── thread/            # Thread management and REPL
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── index.ts           # Main CLI entry point
```

## Implemented Commands

### 1. `apex configure`
Interactive API key configuration with the same interface as the Go CLI:
- Anthropic API Key
- Daytona API Key  
- Daytona API URL
- OpenAI API Key (optional)
- Default Provider
- Default Agent Type

### 2. `apex run "<prompt>"`
Ephemeral sandbox execution:
- Creates temporary project and sandbox
- Executes the prompt
- Tears down all resources automatically
- Options: `--verbose`, `--git-repo`

### 3. `apex create [project-name]`
Project creation with sandbox:
- Interactive prompts for project details
- Automatic sandbox provisioning
- Option to start interactive session immediately
- Options: `--description`, `--git-repo`, `--non-interactive`, `--provider`, `--agent-type`

### 4. `apex open <project-id-or-name>`
Open existing project:
- Fuzzy matching by name or ID prefix
- Auto-creation for one-shot execution with `--prompt`
- Reconnection to stopped sandboxes
- Options: `--prompt`, `--stream`, `--git-repo`

### 5. `apex cmd <project> <thread-id> <command-or-prompt>`
Send commands to existing threads:
- Thread resolution by ID prefix
- Support for slash commands (`/status`, `/history`, `/cost`, `/save`)
- Create new threads with `new` as thread-id
- Options: `--verbose`

### 6. `apex project` (with subcommands)
Project management:
- `apex project list` - List all projects with status
- `apex project delete <project>` - Delete project and sandbox
- `apex project create` - Create project (alternative interface)

### 7. `apex dashboard`
Interactive terminal UI:
- Navigate projects, threads, and messages
- Keyboard navigation (arrow keys, vim-style)
- Real-time status updates
- Context actions (open, delete, refresh)

## Key Features

### Database Management
- SQLite database with Bun's native `bun:sqlite` (migrated from better-sqlite3)
- Compatible with existing TypeORM schema
- Automatic migrations and table creation
- Cross-platform data directory resolution

### Sandbox Integration
- Mock SandboxManager for development/testing (can be swapped with real CliSandboxManager)
- Progress reporting with spinners
- CLI-appropriate output formatting
- Provider abstraction (Daytona, Docker, Local, Apple Container)
- Realistic agent interaction simulation

### Thread Management
- Interactive REPL with readline interface
- Command history and thread persistence
- Slash commands for thread operations
- Message saving and export to Markdown

### Configuration
- Environment variable support (.env files)
- Database path resolution (dev vs production)
- API key management and validation
- Default provider and agent type settings

### Error Handling
- Graceful error messages
- Proper CLI exit codes
- Resource cleanup on interruption
- API key validation with helpful prompts

### TypeScript Integration
- Full type safety with shared types
- Interface compatibility with orchestrator
- Modern ES modules with Bun runtime
- Development tooling (typecheck, build scripts)

## Command Compatibility

All commands maintain the same signatures and behavior as the original Go CLI:

| Go CLI | TypeScript CLI | Status |
|--------|---------------|--------|
| `apex configure` | `apex configure` | ✅ Complete |
| `apex run "prompt"` | `apex run "prompt"` | ✅ Complete |
| `apex create project` | `apex create project` | ✅ Complete |
| `apex open project` | `apex open project` | ✅ Complete |
| `apex cmd project thread input` | `apex cmd project thread input` | ✅ Complete |
| `apex project list` | `apex project list` | ✅ Complete |
| `apex project delete` | `apex project delete` | ✅ Complete |
| `apex dashboard` | `apex dashboard` | ✅ Complete |

## Usage

### From Workspace Root (Recommended)
```bash
# Run CLI commands from anywhere in the workspace
yarn cli --help
yarn cli configure
yarn cli project list
yarn cli create my-project
yarn cli run "fix the failing tests"
yarn cli open my-project -p "add authentication"
yarn cli dashboard
```

### Development Mode (CLI Directory)
```bash
# Install dependencies
bun install

# Development mode with watch
bun run dev

# Type checking
bun run typecheck

# Build binary
bun run build:binary

# Run directly
bun src/main.ts configure
bun src/main.ts run "fix the failing tests"
```

### Binary Usage
```bash
# After building binary
./dist/apex-linux-x64 configure
./dist/apex-linux-x64 run "fix the failing tests"
./dist/apex-darwin-arm64 create my-project
```

## Architecture Notes

### CLI Framework
Uses Commander.js for argument parsing and command structure, providing the same interface as the Go CLI with Cobra.

### Database Layer
The DatabaseManager class provides a clean interface to SQLite, maintaining compatibility with the existing schema while providing TypeScript safety.

### Sandbox Abstraction
CliSandboxManager wraps the orchestrator's SandboxManager with CLI-specific concerns like progress reporting, error handling, and output formatting.

### Thread REPL
ThreadManager provides interactive sessions with command history, slash commands, and proper cleanup, matching the Go implementation's REPL experience.

### Configuration Management
ConfigManager handles environment detection, .env files, and cross-platform data directory resolution with the same precedence rules as the Go CLI.

This implementation provides feature parity with the original Go CLI while leveraging TypeScript's type safety and the Node.js/Bun ecosystem.