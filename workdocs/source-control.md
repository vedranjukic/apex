# Source Control Panel

> VS Code-style git integration: status, staging, committing, push/pull, branch management, sync status, and AI commit message generation.

---

## File Map

| Layer | File | Purpose |
|---|---|---|
| **Orchestrator** | `libs/orchestrator/src/lib/sandbox-manager.ts` | Git CLI methods: `findGitRoot`, `getGitStatus`, `gitStage`, `gitUnstage`, `gitDiscard`, `gitCommit`, `gitPush`, `gitPull`, `listBranches`, `gitCreateBranch`, `gitCheckout` |
| **Orchestrator types** | `libs/orchestrator/src/lib/types.ts` | `GitFileEntry`, `GitFileStatus`, `GitStatusData`, `GitBranchEntry` |
| **Gateway** | `apps/api/src/modules/agent/agent.gateway.ts` | Socket.io handlers for `git_status`, `git_stage`, `git_unstage`, `git_discard`, `git_commit`, `git_push`, `git_pull`, `git_branches`, `git_create_branch`, `git_checkout` |
| **Zustand store** | `apps/dashboard/src/stores/git-store.ts` | `useGitStore` — branch, staged/unstaged/untracked/conflicted arrays, branches list, optimistic actions, stable merge |
| **Socket hook** | `apps/dashboard/src/hooks/use-git-socket.ts` | `useGitSocket` — polls `git_status` every 5s, exposes action callbacks including branch operations |
| **UI component** | `apps/dashboard/src/components/source-control/source-control-panel.tsx` | Full panel: commit input, action button, file sections, AI generate button |
| **Branch picker** | `apps/dashboard/src/components/layout/branch-picker.tsx` | Dropdown from status bar: branch commands (create, create from, checkout detached) + scrollable branch list |
| **Status bar** | `apps/dashboard/src/components/layout/project-status-bar.tsx` | Bottom bar: project name, clickable git branch (opens branch picker), sync status (refresh + ahead/behind counts), sandbox status, VS Code button |
| **Wiring** | `apps/dashboard/src/pages/project-page.tsx` | Creates `useGitSocket` hook, passes actions to status bar + left sidebar |
| **Wiring** | `apps/dashboard/src/components/layout/left-sidebar.tsx` | Threads `gitActions`, `socket`, `sendPrompt` to `SidePanel` |
| **Wiring** | `apps/dashboard/src/components/layout/side-panel.tsx` | Passes props to `SourceControlPanel` when `category === 'git'` |

---

## Socket Protocol

All events use the shared `/ws/agent` namespace (same socket as file tree, terminal, etc.).

| Client emits | Server responds | Payload |
|---|---|---|
| `git_status` | `git_status_result` | `{ projectId }` → `GitStatusData` |
| `git_stage` | `git_op_result` + `git_status_result` | `{ projectId, paths: string[] }` |
| `git_unstage` | `git_op_result` + `git_status_result` | `{ projectId, paths: string[] }` |
| `git_discard` | `git_op_result` + `git_status_result` | `{ projectId, paths: string[] }` |
| `git_commit` | `git_op_result` + `git_status_result` | `{ projectId, message, stageAll? }` |
| `git_push` | `git_op_result` + `git_status_result` | `{ projectId }` |
| `git_pull` | `git_op_result` + `git_status_result` | `{ projectId }` |
| `git_branches` | `git_branches_result` | `{ projectId }` → `{ branches: GitBranchEntry[] }` |
| `git_create_branch` | `git_op_result` + `git_status_result` + `git_branches_result` | `{ projectId, name, startPoint? }` |
| `git_checkout` | `git_op_result` + `git_status_result` + `git_branches_result` | `{ projectId, ref }` |

Every mutation handler automatically re-fetches and emits `git_status_result` after the operation so the UI refreshes. Branch-mutating operations also re-emit `git_branches_result`.

---

## Git Root Discovery

The `findGitRoot(sandboxId)` private method on `SandboxManager` handles the case where the git repo is in a subdirectory of the project root:

1. Runs `git rev-parse --show-toplevel` in the project dir
2. If that fails (project dir is not inside a repo), searches `find <projectDir> -maxdepth 2 -name .git -type d`
3. Returns the discovered root, or `null` if no repo found

All git methods (`getGitStatus`, `gitStage`, etc.) use `findGitRoot` instead of `getProjectDir` directly.

---

## Data Model

Defined in `libs/orchestrator/src/lib/types.ts` and mirrored in the frontend store:

```typescript
type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

interface GitFileEntry {
  path: string;
  status: GitFileStatus;
  oldPath?: string;
}

interface GitStatusData {
  branch: string | null;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  conflicted: GitFileEntry[];
  ahead: number;
  behind: number;
}

interface GitBranchEntry {
  name: string;
  lastUsed: number;   // unix timestamp (committer date)
  isCurrent: boolean;
  isRemote: boolean;
}
```

`GitStatusData` is parsed from `git status --porcelain -b -uall` output. The `-uall` flag ensures individual untracked files are listed instead of collapsed directory entries.

`GitBranchEntry` is parsed from `git branch -a --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)|%(HEAD)'`. Branches are sorted by last commit date (proxy for "last used"), capped at 100 entries. Remote branches with a matching local branch are deduplicated.

---

## Zustand Store (`git-store.ts`)

Key design choices:

- **Optimistic updates**: `optimisticStage`, `optimisticUnstage`, `optimisticDiscard` immediately move files between sections in the UI before the server confirms.
- **Optimistic guard**: `optimisticUntil` timestamp suppresses `setStatus` calls from poll responses for 3 seconds after an optimistic action, preventing visual glitches from stale server data.
- **Guard clearing**: When `git_op_result` arrives (server confirms), the hook resets `optimisticUntil` to 0 so the next `git_status_result` flows through.
- **Stable merge**: `stablemerge()` preserves the existing order of files when reconciling server data — files already in the list keep their position, removed files drop out, new files append at the end.
- **Branch list**: `branches` array stores the result of `git_branches_result`; updated via `setBranches()`. Used by the `BranchPicker` dropdown in the status bar.

---

## UI Component Structure

The `SourceControlPanel` renders (top to bottom):

1. **Branch indicator** — "On branch main"
2. **Commit message textarea** — auto-resizes height, contains a Sparkles icon button for AI generation
3. **Action button** — contextual label:
   - "Commit" when staged files exist and message is typed
   - "Commit All" when only unstaged/untracked changes (uses `stageAll` flag on backend)
   - "Sync Changes N↑ M↓" when clean with ahead/behind
   - Disabled "No Changes" when tree is clean
4. **Collapsible file sections** — Merge Conflicts, Staged Changes, Changes, Untracked
   - Section headers have bulk action buttons (stage all, unstage all, discard all)
   - Per-file rows show: filename, relative path, status badge (M/A/D/R/U/C), hover action buttons (+/-/undo)

---

## Branch Picker (Status Bar)

Clicking the git branch name in the bottom status bar opens a `BranchPicker` dropdown (`branch-picker.tsx`). The dropdown is positioned above the status bar (`absolute bottom-full`) and dismissed on outside click or Escape.

Layout (top to bottom):

1. **Command items** — "Create new branch...", "Create new branch from...", "Checkout detached...". Clicking a command switches to an inline input mode (text fields replace the command list). Enter submits, Escape cancels back to the command list.
2. **Separator** — thin border divider.
3. **Branch list** — scrollable list (`max-h-[320px]`, ~10 items visible), sorted by last used timestamp. Current branch has a green checkmark; others show a branch icon. Remote branches are dimmed. Clicking a branch calls `gitActions.checkout(name)`.

On open, calls `gitActions.listBranches()` to fetch fresh data. The effect depends on `gitActions.listBranches` (a stable `useCallback` reference), not the full `gitActions` object, to avoid re-fetching on unrelated parent re-renders.

## Sync Status (Status Bar)

Next to the branch name in the status bar, a sync button shows (VS Code-style):

- **Refresh icon** (`RefreshCw`) — always visible; spins while a git operation is loading.
- **↓ N** — commits behind (to pull), always shown (even when 0).
- **↑ N** — commits ahead (to push), always shown (even when 0).

The `ahead`/`behind` counts come from `useGitStore` (updated every 5s by `git_status` polling). Clicking the button triggers pull (if behind), push (if ahead), or pull (if fully synced, to check for updates).

The branch label in the status bar reads from `useGitStore.branch` as the primary source (stable across polling cycles), falling back to `info.gitBranch` from `useProjectInfoSocket`, then `project.gitRepo`. This prevents flicker caused by `useProjectInfoSocket` resetting `gitBranch` to `null` during effect cleanup.

---

## AI Commit Message Generator

The Sparkles button inside the commit input triggers AI-powered commit message generation:

1. **Context gathering**: Fetches recent chats for the project, scans messages for references to staged files (via `metadata.referencedFiles` or basename text matching), aggregates up to 4000 chars of relevant excerpts
2. **Prompt construction**: Lists staged files + conversation context, asks for a single conventional commit message line
3. **Execution**: Creates a temporary chat, sends prompt via existing `send_prompt` socket in `ask` mode
4. **Streaming**: Listens for `agent_message` events matching the temp chat ID, streams assistant text into the commit message textarea
5. **Cleanup**: On `result` message, removes listener, deletes temp chat, clears generating state. 60s safety timeout.

---

## Sandbox Commit Identity

Fresh sandboxes may not have `user.name`/`user.email` configured. The `gitCommit` method uses `-c` flags to set identity inline:

```bash
git -c user.name="Apex" -c user.email="user@apex.local" commit -m 'message' 2>&1
```

A 30-second `Promise.race` timeout prevents hangs from misconfigured or unresponsive sandboxes.

---

## How to Add New Git Operations

1. Add a method to `SandboxManager` in the `// Git methods` section (use `findGitRoot`, add `2>&1` for stderr capture)
2. Add a `@SubscribeMessage` handler in `AgentGateway` following the `tryResolveProject` pattern; emit `git_op_result` + re-fetch `git_status_result`
3. Add the action callback in `use-git-socket.ts`
4. Add the corresponding UI in `source-control-panel.tsx`
5. For optimistic updates, add a method in `git-store.ts` and call it from the component before the socket action
