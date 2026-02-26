import { useEffect } from 'react';
import { useCommandStore, type Command } from '../stores/command-store';
import { usePanelsStore } from '../stores/panels-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useChatsStore } from '../stores/tasks-store';
import { useThemeStore } from '../stores/theme-store';
import { themes, themeIds } from '../lib/themes';
import { configApi } from '../api/client';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

// ── Shortcut utilities (shared via export) ──────────────

interface ParsedShortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+');
  return {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: parts[parts.length - 1].toLowerCase(),
  };
}

function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (parsed.mod && !modPressed) return false;
  if (!parsed.mod && modPressed) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  const pressedKey = e.key === '`' ? 'backquote' : e.key.toLowerCase();
  return pressedKey === parsed.key;
}

export function formatShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace('Mod', isMac ? '\u2318' : 'Ctrl')
    .replace('Shift', isMac ? '\u21E7' : 'Shift')
    .replace('Alt', isMac ? '\u2325' : 'Alt')
    .replace('Backquote', '`')
    .replace(/\+/g, isMac ? '' : '+');
}

// ── Default keybindings ─────────────────────────────────

const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'commandPalette.open': 'Mod+Shift+P',
  'sidebar.toggleLeft': 'Mod+B',
  'sidebar.toggleRight': 'Mod+Shift+B',
  'terminal.togglePanel': 'Mod+Backquote',
  'terminal.new': 'Mod+Shift+Backquote',
  'chat.new': 'Mod+Shift+N',
  'explorer.focus': 'Mod+Shift+E',
  'editor.save': 'Mod+S',
};

// ── Keybinding listener (rebuilds when keybindings change) ──

function buildShortcutMap(keybindings: Record<string, string>): Map<string, ParsedShortcut> {
  const map = new Map<string, ParsedShortcut>();
  for (const [cmdId, shortcut] of Object.entries(keybindings)) {
    if (shortcut) {
      map.set(cmdId, parseShortcut(shortcut));
    }
  }
  return map;
}

// ── Hook ────────────────────────────────────────────────

export function useGlobalCommands() {
  const register = useCommandStore((s) => s.register);
  const unregister = useCommandStore((s) => s.unregister);
  const setKeybindings = useCommandStore((s) => s.setKeybindings);

  // Fetch user keybindings from API and merge with defaults
  useEffect(() => {
    let cancelled = false;
    configApi.keybindings().then((userKb) => {
      if (cancelled) return;
      const merged = { ...DEFAULT_KEYBINDINGS, ...userKb };
      setKeybindings(merged);
    }).catch(() => {
      if (cancelled) return;
      setKeybindings({ ...DEFAULT_KEYBINDINGS });
    });
    return () => { cancelled = true; };
  }, [setKeybindings]);

  // Register global commands
  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'commandPalette.open',
        label: 'Command Palette',
        category: 'General',
        execute: () => useCommandStore.getState().togglePalette(),
      },
      {
        id: 'sidebar.toggleLeft',
        label: 'Toggle Left Sidebar',
        category: 'Layout',
        execute: () => usePanelsStore.getState().toggleLeftSidebar(),
      },
      {
        id: 'sidebar.toggleRight',
        label: 'Toggle Right Sidebar',
        category: 'Layout',
        execute: () => usePanelsStore.getState().toggleRightSidebar(),
      },
      {
        id: 'terminal.togglePanel',
        label: 'Toggle Terminal Panel',
        category: 'Layout',
        execute: () => useTerminalStore.getState().togglePanel(),
      },
      {
        id: 'chat.new',
        label: 'New Chat',
        category: 'Chat',
        execute: () => useChatsStore.getState().startNewChat(),
      },
      {
        id: 'explorer.focus',
        label: 'Show Explorer',
        category: 'Explorer',
        execute: () => {
          const panels = usePanelsStore.getState();
          if (!panels.leftSidebarOpen) panels.setLeftSidebar(true);
        },
      },
      {
        id: 'theme.cycle',
        label: 'Cycle Color Theme',
        category: 'Preferences',
        execute: () => useThemeStore.getState().cycleTheme(),
      },
      ...themeIds.map((id) => ({
        id: `theme.set.${id}`,
        label: `Color Theme: ${themes[id].label}`,
        category: 'Preferences',
        execute: () => useThemeStore.getState().setTheme(id),
      })),
    ];

    const ids = commands.map((c) => c.id);
    register(commands);
    return () => { unregister(ids); };
  }, [register, unregister]);

  // Global keydown listener - reads keybindings from store on each event
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const store = useCommandStore.getState();

      if (store.paletteOpen && e.key === 'Escape') {
        e.preventDefault();
        store.closePalette();
        return;
      }

      const shortcutMap = buildShortcutMap(store.keybindings);
      for (const [cmdId, parsed] of shortcutMap) {
        if (matchesShortcut(e, parsed)) {
          e.preventDefault();
          e.stopPropagation();
          store.execute(cmdId);
          return;
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => { document.removeEventListener('keydown', handleKeyDown, true); };
  }, []);
}
