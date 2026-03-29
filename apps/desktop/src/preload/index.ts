import { Electroview } from 'electrobun/view';
import type { ApexRPCType } from '../shared/rpc-types';

const rpc = Electroview.defineRPC<ApexRPCType>({
  handlers: {
    requests: {},
    messages: {
      setConfig: ({ platform, detectedIDEs }) => {
        const apex = (window as any).apex;
        if (apex) {
          apex.platform = platform;
          apex.detectedIDEs = detectedIDEs;
        }
      },
    },
  },
});

const electroview = new Electroview({ rpc });

const origin = window.location.origin;

// Override window.open to route through the main process
const _windowOpen = window.open;
window.open = function (
  url?: string | URL,
  target?: string,
  features?: string
): WindowProxy | null {
  if (!url) return null;
  try {
    const resolved = new URL(String(url), origin);
    if (resolved.origin === origin) {
      electroview.rpc.send.openWindow({ urlPath: resolved.pathname });
    } else {
      electroview.rpc.send.openExternal({ url: resolved.href });
    }
  } catch {
    electroview.rpc.send.openExternal({ url: String(url) });
  }
  return null;
};

(window as any).apex = {
  platform: 'unknown',
  isElectron: true,
  detectedIDEs: { cursor: false, vscode: false },
  openWindow: (urlPath: string) => {
    electroview.rpc.send.openWindow({ urlPath });
  },
  focusOrOpenWindow: (urlPath: string) => {
    electroview.rpc.send.focusOrOpenWindow({ urlPath });
  },
  openInIDE: (params: {
    ide: 'cursor' | 'vscode';
    sshUser: string;
    sshHost: string;
    sshPort: number;
    sandboxId: string;
    remotePath: string;
  }) => {
    return electroview.rpc.request.openInIDE(params);
  },
  showContextMenu: (items: Array<{
    label?: string;
    action?: string;
    type?: 'separator';
    accelerator?: string;
    enabled?: boolean;
  }>) => {
    return electroview.rpc.request.showContextMenu({ items });
  },
};
