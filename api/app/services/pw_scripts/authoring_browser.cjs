// Long-lived, pre-authenticated automation Chrome for live spec-authoring (#400).
// Args: baseUrl, port, profileDir.
//
// Launches a real Chrome/Edge (NOT via Playwright's launcher, so no automation
// fingerprint) on a FIXED --remote-debugging-port using a DEDICATED, persistent
// --user-data-dir. A dedicated non-default profile is deliberate: it lets
// browser-harness attach over CDP (BU_CDP_URL=http://127.0.0.1:<port>) without
// the Chrome "Allow remote debugging" popup / default-profile lockdown (see
// browser_harness/daemon.py:128-131,148). Auth is inherited from the persistent
// profile — reuse the capture `browser-profile` dir (already logged in via the
// manual-login capture flow), so the session is present without any injection.
//
// Unlike capture_auth.cjs (a short snapshot loop) this stays ALIVE for the whole
// authoring session and only tears Chrome down when the parent closes our stdin
// (cross-platform cleanup), on SIGTERM/SIGINT, or when Chrome exits on its own.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const [, , baseUrl, portArg, profileDir] = process.argv;
const PORT = parseInt(portArg, 10);

process.on('unhandledRejection', (e) => console.error('authoring_browser unhandledRejection:', e && (e.message || e)));
process.on('uncaughtException', (e) => console.error('authoring_browser uncaughtException:', e && (e.message || e)));

function findBrowser() {
  // Explicit override wins (the Docker image sets QAGENT_CHROME_BIN=/usr/bin/chromium).
  const c = [
    process.env.QAGENT_CHROME_BIN,
    // Linux / container (Debian chromium package + common Chrome paths).
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Windows host (native dev).
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const p of c) { try { if (p && fs.existsSync(p)) return p; } catch {} }
  return null;
}

// Headless container flags: a Linux host with no X display can't run headed
// Chrome, and Chrome-as-root in a container needs --no-sandbox; the small
// default /dev/shm makes --disable-dev-shm-usage necessary. On a real desktop
// (Windows, or Linux with DISPLAY) we launch headed so the operator can watch
// and MSAL/federated auth behaves like a normal browser.
function containerFlags() {
  const headless = process.platform !== 'win32' && !process.env.DISPLAY;
  return headless
    ? ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    : [];
}

async function waitForCDP(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

(async () => {
  if (!PORT || Number.isNaN(PORT)) { console.error('authoring_browser: invalid port', portArg); process.exit(1); }
  const exe = findBrowser();
  if (!exe) { console.error('authoring_browser: no Chrome/Edge found on this machine'); process.exit(1); }
  fs.mkdirSync(profileDir, { recursive: true });

  // Same third-party-cookie seed as capture: fresh profiles break the MSAL/Entra
  // federation redirects. No-op when the profile was already seeded by capture.
  try {
    const defDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defDir, { recursive: true });
    const prefsPath = path.join(defDir, 'Preferences');
    if (!fs.existsSync(prefsPath)) {
      fs.writeFileSync(prefsPath, JSON.stringify({
        profile: { cookie_controls_mode: 0, block_third_party_cookies: false,
          default_content_setting_values: { cookies: 1 } },
      }));
    }
  } catch (e) { console.error('pref seed failed:', e && e.message); }

  const child = spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--new-window',
    ...containerFlags(),
    baseUrl,
  ], { detached: false, stdio: 'ignore' });
  console.error('authoring_browser launched:', exe, 'port', PORT);

  if (!(await waitForCDP(PORT, 20000))) {
    console.error('authoring_browser: CDP endpoint never came up on port', PORT);
    try { child.kill(); } catch {}
    process.exit(1);
  }

  // Signal readiness on stdout so the Python service can proceed (it also polls
  // /json/version independently). The daemon will resolve BU_CDP_URL to the WS.
  console.log(`AUTHORING_BROWSER_READY ${PORT}`);

  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { child.kill(); } catch {}
    process.exit(code || 0);
  };

  // Cleanup triggers: parent closes our stdin (works cross-platform, incl.
  // Windows where a terminate() won't run signal handlers), OS signals, or
  // Chrome exiting on its own.
  child.on('exit', () => shutdown(0));
  process.stdin.on('end', () => shutdown(0));
  process.stdin.on('close', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  process.stdin.resume();
})().catch((e) => {
  console.error('authoring_browser fatal:', e && (e.stack || e.message || e));
  process.exit(1);
});
