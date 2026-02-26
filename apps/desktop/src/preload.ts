import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('apex', {
  platform: process.platform,
  isElectron: true,
  openWindow: (urlPath: string) => ipcRenderer.send('open-window', urlPath),
  focusOrOpenWindow: (urlPath: string) => ipcRenderer.send('focus-or-open-window', urlPath),
  detectedIDEs: ipcRenderer.sendSync('get-detected-ides') as {
    cursor: boolean;
    vscode: boolean;
  },
  openInIDE: (params: {
    ide: 'cursor' | 'vscode';
    sshUser: string;
    sshHost: string;
    sshPort: number;
    sandboxId: string;
    remotePath: string;
  }) => ipcRenderer.invoke('open-in-ide', params),
});
