import { create } from 'zustand';

export interface PortInfo {
  port: number;
  protocol: 'tcp';
  process: string;
  command: string;
}

export type PortOrigin = 'auto' | 'user';

export interface PortRelay {
  remotePort: number;
  localPort: number;
  status: 'forwarding' | 'failed' | 'stopped';
  error?: string;
  localhostUrl: string; // localhost:localPort
}

export interface MergedPort {
  port: number;
  protocol: 'tcp';
  process: string;
  command: string;
  origin: PortOrigin;
  active: boolean;
  previewUrl: string;
  relay?: PortRelay; // Port forwarding info for desktop
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
  /** Port forwarding relays for desktop environments */
  portRelays: Record<number, PortRelay>;

  bindProject: (projectId: string) => void;
  setPorts: (ports: PortInfo[]) => void;
  addUserPort: (port: number) => void;
  removeUserPort: (port: number) => void;
  setPreviewUrl: (port: number, url: string) => void;
  closePort: (port: number) => void;
  /** Set port relay status for a specific port */
  setPortRelay: (remotePort: number, relay: PortRelay | null) => void;
  /** Update port relays from WebSocket events */
  updatePortRelays: (relays: PortRelay[]) => void;
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
  portRelays: {},

  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    set({
      projectId,
      ports: [],
      previewUrls: {},
      closedPorts: [],
      portRelays: {},
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
    const { userPorts, previewUrls, closedPorts, projectId, portRelays } = get();
    const newPreviewUrls = { ...previewUrls };
    delete newPreviewUrls[port];
    const newPortRelays = { ...portRelays };
    delete newPortRelays[port];
    const updatedUserPorts = userPorts.filter((p) => p !== port);
    saveUserPorts(projectId, updatedUserPorts);
    set({
      userPorts: updatedUserPorts,
      previewUrls: newPreviewUrls,
      portRelays: newPortRelays,
      closedPorts: closedPorts.includes(port) ? closedPorts : [...closedPorts, port],
    });
  },

  setPortRelay: (remotePort, relay) => {
    const { portRelays } = get();
    const newPortRelays = { ...portRelays };
    if (relay) {
      newPortRelays[remotePort] = relay;
    } else {
      delete newPortRelays[remotePort];
    }
    set({ portRelays: newPortRelays });
  },



  updatePortRelays: (relays) => {
    const portRelays: Record<number, PortRelay> = {};
    for (const relay of relays) {
      portRelays[relay.remotePort] = relay;
    }
    set({ portRelays });
  },

  allPorts: () => {
    const { ports, userPorts, previewUrls, closedPorts, portRelays } = get();
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
        relay: portRelays[p.port],
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
        relay: portRelays[port],
      });
    }

    return result.sort((a, b) => a.port - b.port);
  },

  reset: () => {
    const { projectId } = get();
    set({ 
      ports: [], 
      previewUrls: {}, 
      closedPorts: [], 
      portRelays: {},
      userPorts: loadUserPorts(projectId) 
    });
  },
}));
