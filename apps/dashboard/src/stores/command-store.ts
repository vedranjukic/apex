import { create } from 'zustand';

export interface Command {
  id: string;
  label: string;
  category: string;
  execute: () => void;
}

interface CommandState {
  commands: Map<string, Command>;
  keybindings: Record<string, string>;
  paletteOpen: boolean;

  register: (commands: Command[]) => void;
  unregister: (ids: string[]) => void;
  execute: (id: string) => void;
  setKeybindings: (kb: Record<string, string>) => void;
  getShortcut: (commandId: string) => string | undefined;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

export const useCommandStore = create<CommandState>((set, get) => ({
  commands: new Map(),
  keybindings: {},
  paletteOpen: false,

  register: (commands) => {
    const map = new Map(get().commands);
    for (const cmd of commands) {
      map.set(cmd.id, cmd);
    }
    set({ commands: map });
  },

  unregister: (ids) => {
    const map = new Map(get().commands);
    for (const id of ids) {
      map.delete(id);
    }
    set({ commands: map });
  },

  execute: (id) => {
    const cmd = get().commands.get(id);
    if (cmd) cmd.execute();
  },

  setKeybindings: (kb) => set({ keybindings: kb }),

  getShortcut: (commandId) => get().keybindings[commandId],

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
}));
