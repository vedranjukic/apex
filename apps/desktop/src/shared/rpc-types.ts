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
    };
  }>;
};
