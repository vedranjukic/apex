import { create } from 'zustand';

export interface PortInfo {
  port: number;
  protocol: 'tcp';
  process: string;
  command: string;
}

export type PortOrigin = 'auto' | 'user';

export interface MergedPort {
  port: number;
  protocol: 'tcp';
  process: string;
  command: string;
  origin: PortOrigin;
  active: boolean;
  previewUrl: string;
}

function userPortsKey(projectId: string): string {
  return `apex:userPorts:${projectId}`;
}

function loadUserPorts(projectId: string | null): number[] {
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(userPortsKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p: unknown) => typeof p === 'number') : [];
  } catch {
    return [];
  }
}

function saveUserPorts(projectId: string | null, ports: number[]) {
  if (!projectId) return;
  try {
    localStorage.setItem(userPortsKey(projectId), JSON.stringify(ports));
  } catch { /* ignore */ }
}

interface PortsState {
  projectId: string | null;
  /** Auto-detected ports from the bridge scanner */
  ports: PortInfo[];
  /** Port numbers manually added by the user */
  userPorts: number[];
  /** Cached preview URLs keyed by port number */
  previewUrls: Record<number, string>;
  /** Auto-detected ports the user has explicitly closed (suppressed until they disappear and reappear) */
  closedPorts: number[];

  bindProject: (projectId: string) => void;
  setPorts: (ports: PortInfo[]) => void;
  addUserPort: (port: number) => void;
  removeUserPort: (port: number) => void;
  setPreviewUrl: (port: number, url: string) => void;
  closePort: (port: number) => void;
  /** Merged list of auto-detected + user ports, with origin annotation */
  allPorts: () => MergedPort[];
  reset: () => void;
}

export const usePortsStore = create<PortsState>((set, get) => ({
  projectId: null,
  ports: [],
  userPorts: [],
  previewUrls: {},
  closedPorts: [],

  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    set({
      projectId,
      ports: [],
      previewUrls: {},
      closedPorts: [],
      userPorts: loadUserPorts(projectId),
    });
  },

  setPorts: (ports) => {
    const prev = get().ports;
    const prevSet = new Set(prev.map((p) => p.port));
    const newSet = new Set(ports.map((p) => p.port));
    const closedPorts = get().closedPorts.filter((p) => newSet.has(p) && prevSet.has(p));
    set({ ports, closedPorts });
  },

  addUserPort: (port) => {
    const { userPorts, projectId } = get();
    if (userPorts.includes(port)) return;
    const updated = [...userPorts, port];
    saveUserPorts(projectId, updated);
    set({ userPorts: updated });
  },

  removeUserPort: (port) => {
    const { projectId } = get();
    const updated = get().userPorts.filter((p) => p !== port);
    saveUserPorts(projectId, updated);
    set({ userPorts: updated });
  },

  setPreviewUrl: (port, url) => {
    set({ previewUrls: { ...get().previewUrls, [port]: url } });
  },

  closePort: (port) => {
    const { userPorts, previewUrls, closedPorts, projectId } = get();
    const newPreviewUrls = { ...previewUrls };
    delete newPreviewUrls[port];
    const updatedUserPorts = userPorts.filter((p) => p !== port);
    saveUserPorts(projectId, updatedUserPorts);
    set({
      userPorts: updatedUserPorts,
      previewUrls: newPreviewUrls,
      closedPorts: closedPorts.includes(port) ? closedPorts : [...closedPorts, port],
    });
  },

  allPorts: () => {
    const { ports, userPorts, previewUrls, closedPorts } = get();
    const userSet = new Set(userPorts);
    const closedSet = new Set(closedPorts);
    const seen = new Set<number>();
    const result: MergedPort[] = [];

    for (const p of ports) {
      seen.add(p.port);
      if (closedSet.has(p.port)) continue;
      result.push({
        ...p,
        origin: userSet.has(p.port) ? 'user' : 'auto',
        active: true,
        previewUrl: previewUrls[p.port] ?? '',
      });
    }

    for (const port of userPorts) {
      if (seen.has(port) || closedSet.has(port)) continue;
      result.push({
        port,
        protocol: 'tcp',
        process: '',
        command: '',
        origin: 'user',
        active: false,
        previewUrl: previewUrls[port] ?? '',
      });
    }

    return result.sort((a, b) => a.port - b.port);
  },

  reset: () => {
    const { projectId } = get();
    set({ ports: [], previewUrls: {}, closedPorts: [], userPorts: loadUserPorts(projectId) });
  },
}));
