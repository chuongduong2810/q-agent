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
const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require("electron");
const { startUi } = require(path.join(__dirname, "..", "dist", "src", "ui.js"));

let win = null;
let tray = null;
// The agent's in-process UI URL (port may bump from 7420). Kept so the window can
// be recreated from the tray after a hide/destroy without restarting the agent.
let uiUrl = null;
// Set true only for a real quit (tray "Quit" / update install) — closing the
// window otherwise HIDES it so the agent keeps running (connection + in-flight
// job + the log ring buffer stay alive), and reopening replays the log (#agent-log).
app.isQuitting = false;

/** Show/focus the window, recreating + reloading it if it was destroyed. */
function showWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  createWindow();
  if (uiUrl) win.loadURL(uiUrl);
}

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
  ipcMain.handle("update:install", () => {
    app.isQuitting = true; // let the window close for the install instead of hiding
    return updater.quitAndInstall();
  });
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
  // Closing the window HIDES it (agent keeps running in the tray) unless we're
  // actually quitting — so an in-flight live-authoring/heal session and its log
  // survive, and reopening shows the ongoing log. A real exit is via the tray.
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

/** Tray icon so the agent stays reachable while its window is hidden. */
function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, "icons", "icon-32.png"));
  tray.setToolTip("Q-Agent Local Agent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Q-Agent", click: showWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

// Titlebar controls (from preload → renderer).
ipcMain.on("win:minimize", () => win?.minimize());
ipcMain.on("win:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on("win:close", () => win?.close());

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Start the agent's web UI in-process; load the window once it's listening
  // (the port may bump from 7420 if taken). `open: false` — no browser tab.
  startUi({
    open: false,
    onListening: (url) => {
      uiUrl = url;
      if (win) win.loadURL(url);
    },
  });
  initAutoUpdate();
  app.on("activate", () => showWindow());
});

// Don't quit when the window closes — the agent keeps running in the tray so its
// connection + in-flight job + log survive a window close (#agent-log). A real
// exit only happens via the tray "Quit" (which sets app.isQuitting).
app.on("window-all-closed", () => {
  if (app.isQuitting && process.platform !== "darwin") app.quit();
});
