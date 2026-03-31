# Apex CLI Dashboard

This directory contains multiple dashboard implementations for the Apex CLI, providing different levels of interactivity and user experience.

## Available Dashboard Modes

### 1. Basic Console Dashboard (Default)
**Command:** `apex dashboard`

A simple, non-interactive overview that displays:
- List of projects with status, provider, and creation date
- Thread counts for each project
- Quick information display

**Features:**
- Fast and lightweight
- Works in any terminal environment
- Perfect for quick project overviews
- No dependencies on special terminal features

### 2. Interactive Command-Line Dashboard
**Command:** `apex dashboard --interactive`

A readline-based interactive dashboard that allows:
- Navigation through projects, threads, and messages
- Creating and deleting projects/threads
- Viewing detailed information about threads and messages
- Command-driven interface

**Features:**
- Works with Bun's runtime limitations
- Full CRUD operations on projects and threads
- Detailed message viewing with text wrapping
- Command-based navigation (type `help` for commands)

### 3. React/Ink TUI Dashboard (Experimental)
**Command:** `apex dashboard --ink`

An experimental terminal UI built with React and Ink:
- Three-panel layout (project tree, content viewer, prompt input)
- Keyboard navigation with Tab/Shift+Tab focus switching
- Real-time updates and message streaming
- Interactive question handling
- Fullscreen mode for content viewing

**Features:**
- Modern React-based components
- Advanced keyboard navigation
- Real-time streaming capabilities
- Sandbox integration for sending prompts

**Note:** Currently has compatibility issues with Bun runtime due to React/Ink dependencies.

## File Structure

```
dashboard/
├── index.tsx              # Main React/Ink dashboard (experimental)
├── simple.ts             # Interactive command-line dashboard
├── interactive.ts        # Advanced interactive dashboard (Node.js only)
├── components/           # React components for Ink dashboard
│   ├── ProjectTree.tsx
│   ├── ContentViewer.tsx
│   ├── PromptInput.tsx
│   ├── StatusBar.tsx
│   ├── CreateProjectDialog.tsx
│   └── DeleteConfirmationDialog.tsx
└── README.md            # This file
```

## Database Support

All dashboard implementations support both:
- **SQLite Database**: Production database using better-sqlite3
- **Mock Database**: In-memory database for development/testing when SQLite is unavailable

The dashboards automatically fall back to mock data when SQLite compilation fails (e.g., in environments without C++ build tools).

## Interactive Dashboard Commands

When using `apex dashboard --interactive`, the following commands are available:

### Projects View
- `list` or `l` or `<enter>` - Show projects list
- `select <num>` or `s <num>` - Select project by number
- `create <name>` - Create new project
- `delete <num>` or `d <num>` - Delete project by number
- `refresh` or `r` - Refresh projects list
- `help` or `h` - Show help
- `quit` or `q` - Exit dashboard

### Threads View
- `list` or `l` or `<enter>` - Show threads list
- `select <num>` or `s <num>` - Select thread by number
- `create <title>` - Create new thread
- `refresh` or `r` - Refresh threads list
- `back` or `b` - Go back to projects
- `help` or `h` - Show help

### Messages View
- `list` or `l` or `<enter>` - Show messages
- `refresh` or `r` - Refresh messages
- `back` or `b` - Go back to threads
- `help` or `h` - Show help

## Example Usage

```bash
# Basic overview
apex dashboard

# Interactive mode
apex dashboard --interactive

# Then use commands like:
# > create my-new-project
# > select 1
# > create getting-started
# > select 1
# > back
# > quit

# Experimental Ink mode (currently not working with Bun)
apex dashboard --ink
```

## Implementation Details

### State Management
Each dashboard maintains its own state including:
- Current view (projects/threads/messages)
- Selected project and thread
- Loaded data for current view
- Navigation state

### Database Integration
- Automatic fallback from SQLite to mock database
- Consistent API across all dashboard implementations
- Support for CRUD operations on projects, threads, and messages

### Error Handling
- Graceful handling of database connection issues
- User-friendly error messages
- Automatic cleanup on exit

### Terminal Compatibility
- Works across different terminal environments
- Handles terminal resizing (where supported)
- Proper cleanup of terminal state on exit

## Future Improvements

1. **Ink Dashboard**: Fix React/Ink compatibility with Bun
2. **Real-time Updates**: WebSocket integration for live data updates
3. **Search and Filtering**: Add search capabilities across projects/threads
4. **Export Functionality**: Export data to various formats
5. **Theming**: Customizable color themes
6. **Shortcuts**: More keyboard shortcuts for common actions
7. **Sandbox Integration**: Direct prompt sending from interactive dashboards

## Development

When developing new dashboard features:

1. Test with both SQLite and mock databases
2. Ensure proper cleanup on exit
3. Handle terminal resize events
4. Provide clear user feedback for all operations
5. Follow consistent error handling patterns