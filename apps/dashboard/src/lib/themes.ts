import type { ITheme } from '@xterm/xterm';

export type ThemeId = 'midnight-blue' | 'dark' | 'light';

export interface AppTheme {
  id: ThemeId;
  label: string;
  terminalTheme: ITheme;
}

// ── Midnight Blue (default) ─────────────────────────────

const midnightBlueTerminal: ITheme = {
  background: '#151929',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#151929',
  selectionBackground: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

// ── Dark (Cursor Dark Modern inspired) ──────────────────

const darkTerminal: ITheme = {
  background: '#0f0f0f',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#0f0f0f',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#e5e510',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

// ── Light (VS Code Light+ inspired) ────────────────────

const lightTerminal: ITheme = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

// ── Theme registry ──────────────────────────────────────

export const themes: Record<ThemeId, AppTheme> = {
  'midnight-blue': {
    id: 'midnight-blue',
    label: 'Midnight Blue',
    terminalTheme: midnightBlueTerminal,
  },
  dark: {
    id: 'dark',
    label: 'Dark Modern',
    terminalTheme: darkTerminal,
  },
  light: {
    id: 'light',
    label: 'Light',
    terminalTheme: lightTerminal,
  },
};

export const themeIds = Object.keys(themes) as ThemeId[];
