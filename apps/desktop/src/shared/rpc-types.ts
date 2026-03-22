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

export type ApexRPCType = {
  bun: RPCSchema<{
    requests: {
      openInIDE: {
        params: OpenInIDEParams;
        response: { ok: boolean; error?: string };
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
