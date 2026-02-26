# Command Registry & Keybindings

The app has a VS Code-style command system. Every user-facing action should be registered as a command so it is accessible via the command palette (Ctrl+Shift+P) and optionally bound to a keyboard shortcut.

## Architecture

```
keybindings.json          User-editable shortcut map (workspace root, next to .env)
        |
        v
GET /api/config/keybindings   API endpoint serves the file
        |
        v
useGlobalCommands()       Fetches keybindings, registers global commands, keydown listener
  (app.tsx)               Merges user overrides on top of DEFAULT_KEYBINDINGS
        |
        v
useCommandStore           Zustand store holding commands Map + keybindings Record
        |
        +---> CommandPalette     Reads commands + keybindings for display
        +---> keydown listener   Matches pressed keys against keybindings -> executes command
        |
useProjectCommands()      Registers project-scoped commands (terminal, agent slash commands)
  (project-page.tsx)      Unregisters on unmount
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/dashboard/src/stores/command-store.ts` | Zustand store: `commands` Map, `keybindings` Record, palette state |
| `apps/dashboard/src/hooks/use-global-commands.ts` | Registers global commands, fetches keybindings, runs keydown listener |
| `apps/dashboard/src/hooks/use-project-commands.ts` | Registers project-scoped commands (terminal, agent) |
| `apps/dashboard/src/components/command-palette/command-palette.tsx` | The search dialog UI |
| `keybindings.json` | User-editable shortcut overrides (workspace root) |
| `apps/api/src/modules/config/config-app.controller.ts` | Serves keybindings.json via `GET /api/config/keybindings` |

## Command Interface

```typescript
interface Command {
  id: string;        // e.g. "sidebar.toggleLeft", "agent.compact"
  label: string;     // Human-readable, shown in palette: "Toggle Left Sidebar"
  category: string;  // Grouping in palette: "Layout", "Terminal", "Agent", etc.
  execute: () => void;
}
```

Commands do NOT carry their shortcut. Shortcuts live in the `keybindings` Record in the store, keyed by command ID.

## How to Add a New Command

1. **Pick an ID** using `category.action` convention (e.g. `editor.formatDocument`).

2. **Choose where to register it:**
   - **Global** (works on all pages) -- add to the `commands` array in `use-global-commands.ts`
   - **Project-scoped** (needs project socket context) -- add to the `commands` array in `use-project-commands.ts`

3. **Define the command object:**
   ```typescript
   {
     id: 'editor.formatDocument',
     label: 'Format Document',
     category: 'Editor',
     execute: () => {
       // Call store actions, socket methods, etc.
       // Use SomeStore.getState().action() to avoid React hook rules
     },
   }
   ```

4. **Optionally assign a default keybinding** by adding an entry to `DEFAULT_KEYBINDINGS` in `use-global-commands.ts`:
   ```typescript
   'editor.formatDocument': 'Mod+Shift+F',
   ```
   Also add the same entry to `keybindings.json` at the workspace root so users see the default.

5. That's it. The command automatically appears in the command palette and responds to its keybinding.

## Shortcut Format

Shortcuts are strings with `+`-separated modifiers and a key:

- `Mod` -- Ctrl on Linux/Windows, Cmd on Mac
- `Shift`, `Alt` -- as expected
- Key is the last segment, lowercased: `p`, `b`, `n`, `Backquote` (for the `` ` `` key)

Examples: `Mod+Shift+P`, `Mod+B`, `Mod+Backquote`, `Alt+Shift+F`

## Adding Agent Slash Commands

Agent commands send a slash command to the active Claude chat. Use the `buildAgentCommand` helper in `use-project-commands.ts`:

```typescript
buildAgentCommand('agent.myCommand', 'Agent: My Command', '/mycommand', sendPrompt)
```

This creates a command that calls `sendPrompt(activeChatId, '/mycommand')` when executed. These are project-scoped since they require an active chat session.

## Existing Commands

**Global (registered in `use-global-commands.ts`):**

| ID | Label | Default Shortcut |
|----|-------|-----------------|
| `commandPalette.open` | Command Palette | `Mod+Shift+P` |
| `sidebar.toggleLeft` | Toggle Left Sidebar | `Mod+B` |
| `sidebar.toggleRight` | Toggle Right Sidebar | `Mod+Shift+B` |
| `terminal.togglePanel` | Toggle Terminal Panel | `Mod+Backquote` |
| `chat.new` | New Chat | `Mod+Shift+N` |
| `explorer.focus` | Show Explorer | `Mod+Shift+E` |
| `editor.save` | Save File | `Mod+S` |
| `theme.cycle` | Cycle Color Theme | -- |
| `theme.set.midnight-blue` | Color Theme: Midnight Blue | -- |
| `theme.set.dark` | Color Theme: Dark | -- |
| `theme.set.light` | Color Theme: Light | -- |

**Project-scoped (registered in `use-project-commands.ts`):**

| ID | Label | Default Shortcut |
|----|-------|-----------------|
| `terminal.new` | New Terminal | `Mod+Shift+Backquote` |
| `project.fork` | Fork Project | -- |
| `editor.save` | Save File | `Mod+S` |
| `agent.clear` | Agent: Clear Context | -- |
| `agent.compact` | Agent: Compact History | -- |
| `agent.cost` | Agent: Show Token Usage | -- |
| `agent.help` | Agent: Help | -- |
| `agent.init` | Agent: Init Project | -- |
| `agent.model` | Agent: Switch Model | -- |
| `agent.doctor` | Agent: Doctor | -- |
| `agent.memory` | Agent: Edit Memory | -- |
| `agent.review` | Agent: Code Review | -- |
| `agent.config` | Agent: Settings | -- |
| `agent.context` | Agent: Show Context | -- |
| `agent.status` | Agent: Status | -- |
| `agent.export` | Agent: Export Chat | -- |
| `agent.debug` | Agent: Debug Session | -- |
| `agent.permissions` | Agent: Permissions | -- |
| `agent.plan` | Agent: Plan Mode | -- |
| `agent.stats` | Agent: Usage Stats | -- |
| `agent.todos` | Agent: List TODOs | -- |
| `agent.theme` | Change Color Theme | -- |
