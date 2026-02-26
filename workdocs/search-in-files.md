# Search in Files

> VS Code-style full-text search across the project workspace, accessible from the left sidebar.

## Overview

The Search panel lets users search file contents inside the Daytona sandbox. It supports match case, whole word, regex, and file include/exclude filters. Results are grouped by file with highlighted matches; clicking a result opens the file in the editor.

## Architecture

```
SearchPanel (UI)
  → useSearchSocket (hook) emits "file_search" via Socket.io
    → AgentGateway.handleFileSearch (NestJS)
      → SandboxManager.searchFiles (orchestrator)
        → grep executed inside Daytona sandbox
      ← parsed SearchResult[]
    ← emits "file_search_result" back to client
  → useSearchStore.setResults (Zustand)
  → UI re-renders with grouped, highlighted results
```

## File Map

| File | Purpose |
|------|---------|
| `apps/dashboard/src/components/search/search-panel.tsx` | Search UI: input with inline toggle icons, include/exclude filters, collapsible result tree with highlighted matches |
| `apps/dashboard/src/stores/search-store.ts` | Zustand store: query, toggle states, include/exclude patterns, results, loading/expanded state |
| `apps/dashboard/src/hooks/use-search-socket.ts` | Socket hook: emits `file_search`, listens for `file_search_result`, 35s client-side timeout safety |
| `apps/api/src/modules/agent/agent.gateway.ts` | `@SubscribeMessage('file_search')` handler with 30s server-side timeout |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | `searchFiles()` method: builds and runs `grep` command, parses output into `SearchResult[]` |
| `libs/orchestrator/src/lib/types.ts` | `SearchMatch` and `SearchResult` interfaces |

## Socket Protocol

**Client → Server**: `file_search`
```typescript
{
  projectId: string;
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  includePattern?: string;   // comma-separated globs, e.g. "*.ts, src/"
  excludePattern?: string;   // comma-separated globs/dirs, e.g. "*.min.js, tmp"
}
```

**Server → Client**: `file_search_result`
```typescript
{
  query: string;
  results: SearchResult[];   // grouped by file
  error?: string;
}
```

## Search Engine (grep)

Search runs `grep -rn` inside the sandbox with the project root as the working directory.

**Flag mapping:**
- Match case off → `-i`
- Whole word → `-w`
- Regex mode → `-E` (extended regex); otherwise `-F` (fixed string)
- Include pattern → `--include=<glob>` per comma-separated entry
- Exclude pattern → `--exclude=<glob>` (file patterns) or `--exclude-dir=<name>` (directories)

**Output limit:** piped through `head -2000` to cap payload size.

**Search directory:** resolved via `SandboxManager.getProjectDir(sandboxId, projectName)`, which returns the project slug path (e.g. `/home/daytona/my-project`).

## Default Excluded Directories

A comprehensive list of well-known directories is excluded by default without the user needing to type them. The "files to exclude" input in the UI stays empty. If the user types a directory name in "files to include", that directory is removed from the default exclude list so it gets searched.

Default excludes:
- **VCS**: `.git`, `.svn`, `.hg`
- **JS/Node**: `node_modules`, `.npm`, `.yarn`, `.pnp`, `bower_components`
- **Build output**: `dist`, `build`, `out`, `.output`, `.next`, `.nuxt`, `.svelte-kit`
- **Bundler/cache**: `.cache`, `.parcel-cache`, `.turbo`, `.vite`
- **Python**: `__pycache__`, `.venv`, `venv`, `env`, `.mypy_cache`, `.pytest_cache`, `.tox`
- **Rust**: `target`
- **Go**: `vendor`
- **Java/JVM**: `.gradle`, `.m2`, `.mvn`
- **IDE**: `.idea`, `.vscode`, `.vs`
- **Misc**: `coverage`, `.nyc_output`, `.terraform`, `tmp`, `.tmp`

## UI Behavior

- **Debounced input**: 150ms after typing stops, minimum 2 characters
- **Enter key**: triggers search immediately (bypasses debounce)
- **Toggle buttons** (inside the search input): Match Case, Whole Word, Regex -- toggling re-triggers search
- **Include/Exclude inputs**: always visible below the search input
- **Results tree**: files are collapsible, all expanded by default on new results. Each match shows line number and content with the query highlighted.
- **Click to open**: clicking a match line opens the file in the code editor
- **Loading state**: spinner shown while waiting for results; 35s client-side timeout clears the spinner if the backend never responds

## Zustand Store Shape

```typescript
interface SearchState {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  includePattern: string;
  excludePattern: string;
  results: SearchResult[];
  isSearching: boolean;
  expandedFiles: Set<string>;
}
```

Key actions: `setQuery`, `toggleMatchCase`, `toggleWholeWord`, `toggleUseRegex`, `setIncludePattern`, `setExcludePattern`, `setResults`, `setIsSearching`, `toggleFileExpanded`, `clearResults`, `reset`.
