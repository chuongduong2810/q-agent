/**
 * Electron desktop shell for the Local Agent.
 *
 * Runs the agent's own web UI server (dist/src/ui.js) in-process and shows it in
 * a small, frameless native window — the UI draws its own titlebar (client
 * design). Window controls are wired over IPC via preload.cjs. Child processes
 * (Playwright CLI, login capture) are spawned via `nodeBin()` = this Electron
 * binary with ELECTRON_RUN_AS_NODE=1 (see paths.ts `childNodeEnv`).
 *
 * Dev:   npm run desktop         (builds, then launches)
 * Build: npm run dist:desktop    (electron-builder → Windows installer)
 */
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { startUi } = require(path.join(__dirname, "..", "dist", "src", "ui.js"));

let win = null;

/** Wire the update feed (build.publish → latest.yml on the server's /downloads/
 * route) to an EXPLICIT, user-driven flow: we notify the renderer that a version
 * is available and only download / install when the user asks (see preload's
 * `qagentUpdate` + the UI's update banner). Guarded to packaged builds and fully
 * best-effort — offline / no-feed / any error can never block the agent. */
function initAutoUpdate() {
  if (!app.isPackaged) return; // dev (`npm run desktop`) has no update feed
  let updater;
  try {
    updater = require("electron-updater").autoUpdater;
  } catch {
    return; // electron-updater unavailable — skip silently
  }
  updater.autoDownload = false; // ask the user before downloading
  updater.autoInstallOnAppQuit = true; // if they defer, apply on the next quit

  const send = (channel, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
  updater.on("update-available", (info) => send("update:available", { version: info.version }));
  updater.on("update-not-available", () => send("update:none", {}));
  updater.on("download-progress", (p) => send("update:progress", { percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", (info) => send("update:downloaded", { version: info.version }));
  updater.on("error", (err) => send("update:error", { message: String((err && err.message) || err) }));

  // Renderer-driven (the UI checks on load + periodically, so it never misses
  // the event by subscribing too late). Errors resolve, never reject.
  ipcMain.handle("update:check", () => updater.checkForUpdates().catch((e) => ({ error: String(e) })));
  ipcMain.handle("update:download", () => updater.downloadUpdate().catch((e) => ({ error: String(e) })));
  ipcMain.handle("update:install", () => updater.quitAndInstall());
}

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 600,
    title: "Q-Agent Local Agent",
    backgroundColor: "#0a0a0f",
    frame: false,
    resizable: true,
    icon: path.join(__dirname, "icons", "icon-256.png"),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // External links (e.g. docs) open in the system browser, not a child window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
  });
}

// Titlebar controls (from preload → renderer).
ipcMain.on("win:minimize", () => win?.minimize());
ipcMain.on("win:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on("win:close", () => win?.close());

app.whenReady().then(() => {
  createWindow();
  // Start the agent's web UI in-process; load the window once it's listening
  // (the port may bump from 7420 if taken). `open: false` — no browser tab.
  startUi({
    open: false,
    onListening: (url) => {
      if (win) win.loadURL(url);
    },
  });
  initAutoUpdate();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
