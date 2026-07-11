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

// Explicit, user-driven auto-update bridge (see electron/main.cjs). Present only
// in the desktop app — the browser/npx UI leaves `window.qagentUpdate` undefined.
const UPDATE_CHANNELS = [
  "update:available",
  "update:none",
  "update:progress",
  "update:downloaded",
  "update:error",
];
contextBridge.exposeInMainWorld("qagentUpdate", {
  check: () => ipcRenderer.invoke("update:check"),
  download: () => ipcRenderer.invoke("update:download"),
  install: () => ipcRenderer.invoke("update:install"),
  /** Subscribe to update lifecycle events; returns an unsubscribe fn. */
  on: (cb) => {
    const registered = UPDATE_CHANNELS.map((ch) => {
      const fn = (_e, data) => cb(ch, data);
      ipcRenderer.on(ch, fn);
      return [ch, fn];
    });
    return () => registered.forEach(([ch, fn]) => ipcRenderer.removeListener(ch, fn));
  },
});
