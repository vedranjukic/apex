# Apex CLI Dashboard TUI Implementation

## Overview

We've successfully implemented a full-screen TUI (Terminal User Interface) dashboard for the Apex CLI, inspired by modern terminal applications like OpenCoder. The dashboard provides an intuitive way to manage projects and threads with a professional terminal interface.

## UI Library Choice

After investigating OpenCoder's architecture, we discovered they use **Ink** (React for the terminal). We implemented multiple TUI options with intelligent fallback:

1. **Blessed** (Default) - Stable, mature TUI library used by many professional CLI tools
2. **Ink** (Experimental) - React-based terminal UI, same as OpenCoder (with fallback to blessed)
3. **Raw Terminal** - Custom implementation using escape sequences
4. **Simple Console** - Basic text output for compatibility
5. **Interactive CLI** - Command-driven interface

### Why Blessed as Default?

While OpenCoder uses Ink, we chose **blessed** as the default because:
- **Stability**: More mature and battle-tested
- **Performance**: Lower overhead than React rendering
- **Compatibility**: Works reliably across different environments
- **Features**: Rich widget system perfect for complex UIs
- **Fallback**: Ink experimental option automatically falls back to blessed

## Features Implemented

### ✅ Split Pane Layout
- **Left Panel (60%)**: Project list with foldable projects and nested threads
- **Right Panel (40%)**: Context panel showing detailed information
- **Visual Separator**: Clear borders between panels with active panel highlighting

### ✅ Project List Features
- **Foldable Projects**: Each project can be expanded/collapsed with `▶`/`▼` indicators
- **Thread Display**: When expanded, shows threads under each project with tree-style indentation
- **Status Indicators**: Color-coded status badges ([RUN] green=running, [NEW] yellow=creating, [DONE] blue=completed, [STOP] gray=stopped, [ERR] red=error)
- **Keyboard Navigation**: Full vim-style navigation (↑↓/jk, →←/hl)
- **Thread Counts**: Shows number of threads and messages for each item

### ✅ Context Panel Features
- **Project Context**: Shows project details (name, status, provider, creation date, description, git repo, local directory)
- **Thread Context**: Shows thread details and recent messages when a thread is selected
- **Scrollable Content**: Full scrolling support for long content
- **Message Preview**: Shows recent conversation history with timestamps

### ✅ Navigation & Controls
- **Tab Switching**: Press `Tab` to switch between project list and context panel
- **Panel Highlighting**: Active panel clearly indicated with cyan borders and "(Active)" label
- **Expand/Collapse**: 
  - `→`/`l` to expand projects
  - `←`/`h` to collapse projects  
  - `x` to toggle expansion
  - `Enter`/`Space` to select items
- **Help System**: Press `?` for comprehensive help
- **Graceful Exit**: Press `q` or `Ctrl+C` to quit cleanly

## Usage

### Default TUI Mode (Blessed)
```bash
apex dashboard               # Professional blessed TUI (default)
```

### Alternative Modes
```bash
apex dashboard --ink         # React/Ink-based TUI (experimental, like OpenCoder)
apex dashboard --raw         # Raw terminal TUI 
apex dashboard --simple      # Simple console display
apex dashboard --interactive # Command-based interactive mode
```

### Key Bindings

**Navigation:**
- `↑↓` or `j/k` - Move up/down
- `→/l` - Expand project
- `←/h` - Collapse project  
- `Tab` - Switch between panels

**Actions:**
- `Enter`/`Space` - Select item or toggle expansion
- `x` - Toggle project expansion
- `r` - Refresh all data
- `?` - Show help
- `q`/`Ctrl+C` - Quit

**Context Panel (when active):**
- `j/k` or `↑↓` - Scroll content

## Technical Architecture

### Libraries Used
- **neo-blessed**: Modern fork of blessed for terminal UI components
- **chalk**: Terminal color support
- **commander**: CLI argument parsing

### Data Layer
- **Database Abstraction**: Supports both SQLite and mock data
- **Caching**: Threads and messages are cached for performance
- **Reactive Updates**: Real-time data refresh capabilities

### Code Structure
```
apps/cli/src/dashboard/
├── blessed-dashboard.ts    # Main blessed TUI (default)
├── ink-dashboard.tsx       # React/Ink TUI (experimental)
├── tui.ts                 # Raw terminal TUI
├── simple.ts              # Command-line interactive mode
└── interactive.ts         # Simple console display
```

## Enhanced Mock Data

We've enhanced the mock database with realistic sample data:
- **4 sample projects** with different statuses and providers
- **9 sample threads** across projects with realistic titles
- **Sample conversations** with user/assistant message exchanges
- **Realistic timestamps** and metadata

## Comparison with OpenCoder

Our implementation provides similar functionality to OpenCoder's TUI:
- ✅ Split-pane layout
- ✅ Tree-view navigation  
- ✅ Keyboard shortcuts
- ✅ Professional styling
- ✅ Context switching
- ✅ Help system
- ✅ Responsive design

## Benefits

1. **Professional UX**: Modern terminal interface matching industry standards
2. **Efficiency**: Quick navigation and overview of all projects/threads
3. **Flexibility**: Multiple interface modes for different preferences
4. **Accessibility**: Full keyboard navigation and help system
5. **Scalability**: Handles large numbers of projects and threads efficiently
6. **Compatibility**: Pure ASCII interface works across all terminals and systems

## Future Enhancements

- [ ] Real-time updates from the backend
- [ ] Search/filter functionality
- [ ] Thread creation from TUI
- [ ] Project management operations
- [ ] Integration with git status
- [ ] Color theme customization
- [ ] Mouse support improvements
- [ ] Performance optimizations for large datasets

The TUI dashboard transforms the CLI from a simple command interface into a powerful, interactive development environment that developers will enjoy using.