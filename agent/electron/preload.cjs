/**
 * Preload: exposes the frameless-window controls to the renderer (the UI's
 * custom titlebar calls `window.qagentDesktop.minimize()` etc.). contextIsolation
 * is on, so this is the only bridge — nothing else from Node is exposed.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qagentDesktop", {
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close"),
});
