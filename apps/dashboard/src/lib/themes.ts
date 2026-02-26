import type { ITheme } from '@xterm/xterm';
import type { editor } from 'monaco-editor';

export type ThemeId = 'midnight-blue' | 'dark' | 'light';

export interface AppTheme {
  id: ThemeId;
  label: string;
  monacoBase: 'vs-dark' | 'vs';
  monacoTheme: editor.IStandaloneThemeData;
  terminalTheme: ITheme;
}

// ── Midnight Blue (default) ─────────────────────────────

const midnightBlueMonaco: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e2132',
    'editor.foreground': '#e2e4eb',
    'editor.lineHighlightBackground': '#171a2a',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#6b7280',
    'editorLineNumber.activeForeground': '#9ca3b4',
    'editorCursor.foreground': '#6366f1',
    'editor.selectionBackground': '#6366f133',
    'editor.inactiveSelectionBackground': '#6366f11a',
    'editorWidget.background': '#171a2a',
    'editorWidget.border': '#2e3348',
    'editorIndentGuide.background': '#2e334844',
    'editorIndentGuide.activeBackground': '#2e3348',
    'editorBracketMatch.background': '#6366f122',
    'editorBracketMatch.border': '#6366f155',
    'editorGutter.background': '#1e2132',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#37415166',
    'scrollbarSlider.hoverBackground': '#4b556366',
    'scrollbarSlider.activeBackground': '#4b5563aa',
  },
};

const midnightBlueTerminal: ITheme = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
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

// ── Dark (VS Code Dark+ inspired) ──────────────────────

const darkMonaco: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#2a2d2e',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editorCursor.foreground': '#aeafad',
    'editor.selectionBackground': '#264f78',
    'editor.inactiveSelectionBackground': '#3a3d41',
    'editorWidget.background': '#252526',
    'editorWidget.border': '#454545',
    'editorIndentGuide.background': '#40404044',
    'editorIndentGuide.activeBackground': '#707070',
    'editorBracketMatch.background': '#0064001a',
    'editorBracketMatch.border': '#888888',
    'editorGutter.background': '#1e1e1e',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#79797966',
    'scrollbarSlider.hoverBackground': '#64646466',
    'scrollbarSlider.activeBackground': '#bfbfbf66',
  },
};

const darkTerminal: ITheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
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

const lightMonaco: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#333333',
    'editor.lineHighlightBackground': '#f5f5f5',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#999999',
    'editorLineNumber.activeForeground': '#0b216f',
    'editorCursor.foreground': '#000000',
    'editor.selectionBackground': '#add6ff',
    'editor.inactiveSelectionBackground': '#e5ebf1',
    'editorWidget.background': '#f3f3f3',
    'editorWidget.border': '#c8c8c8',
    'editorIndentGuide.background': '#d3d3d344',
    'editorIndentGuide.activeBackground': '#939393',
    'editorBracketMatch.background': '#0064001a',
    'editorBracketMatch.border': '#b9b9b9',
    'editorGutter.background': '#ffffff',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#64646466',
    'scrollbarSlider.hoverBackground': '#64646488',
    'scrollbarSlider.activeBackground': '#646464aa',
  },
};

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
    monacoBase: 'vs-dark',
    monacoTheme: midnightBlueMonaco,
    terminalTheme: midnightBlueTerminal,
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    monacoBase: 'vs-dark',
    monacoTheme: darkMonaco,
    terminalTheme: darkTerminal,
  },
  light: {
    id: 'light',
    label: 'Light',
    monacoBase: 'vs',
    monacoTheme: lightMonaco,
    terminalTheme: lightTerminal,
  },
};

export const themeIds = Object.keys(themes) as ThemeId[];
