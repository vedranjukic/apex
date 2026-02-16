"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('apex', {
    platform: process.platform,
    isElectron: true,
    openWindow: (urlPath) => electron_1.ipcRenderer.send('open-window', urlPath),
    focusOrOpenWindow: (urlPath) => electron_1.ipcRenderer.send('focus-or-open-window', urlPath),
    detectedIDEs: electron_1.ipcRenderer.sendSync('get-detected-ides'),
    openInIDE: (params) => electron_1.ipcRenderer.invoke('open-in-ide', params),
});
//# sourceMappingURL=preload.js.map