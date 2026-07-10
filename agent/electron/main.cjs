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

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: 380,
    minHeight: 520,
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
