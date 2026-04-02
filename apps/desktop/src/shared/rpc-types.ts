import type { RPCSchema } from 'electrobun';

export interface DetectedIDEs {
  cursor: boolean;
  vscode: boolean;
}

export interface OpenInIDEParams {
  ide: 'cursor' | 'vscode';
  sshUser: string;
  sshHost: string;
  sshPort: number;
  sandboxId: string;
  remotePath: string;
}

export interface ContextMenuItem {
  label?: string;
  action?: string;
  type?: 'separator';
  accelerator?: string;
  enabled?: boolean;
}

export interface PortRelayConfig {
  enabled: boolean;
  autoForwardNewPorts: boolean;
  portRange: {
    start: number;
    end: number;
  };
  excludedPorts: number[];
}

export interface RelayedPort {
  remotePort: number;
  localPort: number;
  sandboxId: string;
  status: 'active' | 'failed' | 'stopped';
  error?: string;
  createdAt: number;
}

export type ApexRPCType = {
  bun: RPCSchema<{
    requests: {
      openInIDE: {
        params: OpenInIDEParams;
        response: { ok: boolean; error?: string };
      };
      showContextMenu: {
        params: { items: ContextMenuItem[] };
        response: { action: string | null };
      };
      getPortRelayConfig: {
        params: {};
        response: PortRelayConfig;
      };
      setPortRelayConfig: {
        params: PortRelayConfig;
        response: { ok: boolean; error?: string };
      };
      forwardPort: {
        params: { sandboxId: string; remotePort: number; localPort?: number };
        response: { ok: boolean; localPort?: number; error?: string };
      };
      unforwardPort: {
        params: { sandboxId: string; remotePort: number };
        response: { ok: boolean; error?: string };
      };
      getRelayedPorts: {
        params: { sandboxId?: string };
        response: { ports: RelayedPort[] };
      };
    };
    messages: {
      openWindow: { urlPath: string };
      focusOrOpenWindow: { urlPath: string };
      openExternal: { url: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      setConfig: {
        platform: string;
        detectedIDEs: DetectedIDEs;
      };
      portRelayStatusUpdate: {
        sandboxId: string;
        ports: RelayedPort[];
      };
      portRelayConfigUpdate: {
        config: PortRelayConfig;
      };
    };
  }>;
};
