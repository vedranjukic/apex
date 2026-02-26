import { create } from 'zustand';

export interface PortInfo {
  port: number;
  protocol: 'tcp';
  process: string;
}

interface PortsState {
  ports: PortInfo[];
  setPorts: (ports: PortInfo[]) => void;
  reset: () => void;
}

export const usePortsStore = create<PortsState>((set) => ({
  ports: [],
  setPorts: (ports) => set({ ports }),
  reset: () => set({ ports: [] }),
}));
