/**
 * Electron desktop shell for the Local Agent.
 *
 * Runs the agent's own web UI server (dist/src/ui.js) in-process and shows it in
 * a native window — so the entire UI (pairing, live pull/run progress) is reused
 * as-is. Child processes (Playwright CLI, login capture) are spawned via
 * `nodeBin()` = this Electron binary with ELECTRON_RUN_AS_NODE=1 (see paths.ts
 * `childNodeEnv`), so no separate Node is required.
 *
 * Dev:   npm run desktop         (builds, then launches)
 * Build: npm run dist:desktop    (electron-builder → Windows installer)
 */
const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");
const { startUi } = require(path.join(__dirname, "..", "dist", "src", "ui.js"));

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 820,
    minWidth: 440,
    minHeight: 600,
    title: "Q-Agent Local Agent",
    backgroundColor: "#0f0f16",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
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
