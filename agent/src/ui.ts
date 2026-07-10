/**
 * Local web UI for the agent, served on 127.0.0.1 and opened in the browser.
 *
 * Lets the user connect by pasting a pair code + server URL (no CLI), then shows
 * live pulling/execution progress streamed from the job loop over SSE. Styled to
 * match the Q-Agent app (dark, glass, violet). No framework / no extra deps —
 * Node's built-in http plus the in-process event bus (bus.ts).
 */
import { spawn } from "node:child_process";
import * as http from "node:http";
import * as os from "node:os";
import { redeemDevice } from "./api";
import { bus, emit, recentEvents } from "./bus";
import { AgentConfig, clearConfig, loadConfig, saveConfig } from "./config";
import { killActiveChild, runAgentLoop } from "./runner";

let signal = { aborted: false };
let running = false;

/** Start the claim→run loop for `cfg` (no-op if already running). */
function startLoop(cfg: AgentConfig): void {
  if (running) return;
  running = true;
  signal = { aborted: false };
  emit("agent-status", { running: true, deviceId: cfg.deviceId, deviceName: cfg.deviceName, serverUrl: cfg.serverUrl });
  runAgentLoop(cfg, signal)
    .catch((err) => emit("error", { message: (err as Error).message || String(err) }))
    .finally(() => {
      running = false;
      emit("agent-status", { running: false });
    });
}

function stopLoop(): void {
  signal.aborted = true;
  killActiveChild();
  running = false;
}

function state() {
  const cfg = loadConfig();
  return {
    paired: Boolean(cfg),
    running,
    deviceId: cfg?.deviceId ?? null,
    deviceName: cfg?.deviceName ?? null,
    serverUrl: cfg?.serverUrl ?? "",
    events: recentEvents(),
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

function openBrowser(url: string): void {
  try {
    const opts = { detached: true, stdio: "ignore" as const };
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], opts).unref();
    else if (process.platform === "darwin") spawn("open", [url], opts).unref();
    else spawn("xdg-open", [url], opts).unref();
  } catch {
    // Non-fatal: the URL is printed to the console as a fallback.
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url || "/";

  if (req.method === "GET" && (url === "/" || url.startsWith("/?"))) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }

  if (req.method === "GET" && url === "/api/state") {
    sendJson(res, 200, state());
    return;
  }

  if (req.method === "POST" && url === "/api/pair") {
    try {
      const { code, server } = JSON.parse((await readBody(req)) || "{}");
      const serverUrl = String(server || "").replace(/\/+$/, "");
      if (!code || !serverUrl) return sendJson(res, 400, { error: "Pair code and server URL are required." });
      const name = os.hostname();
      const { deviceToken, deviceId } = await redeemDevice(serverUrl, String(code).trim(), name);
      const cfg: AgentConfig = { serverUrl, deviceToken, deviceId, deviceName: name };
      saveConfig(cfg);
      emit("log", { message: `Paired as device #${deviceId} (${name})` });
      startLoop(cfg);
      sendJson(res, 200, { ok: true, deviceId });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message || "Pairing failed" });
    }
    return;
  }

  if (req.method === "POST" && url === "/api/disconnect") {
    stopLoop();
    clearConfig();
    emit("agent-status", { running: false });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    for (const ev of recentEvents()) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const onEvent = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    bus.on("event", onEvent);
    const ka = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ka);
      bus.off("event", onEvent);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

/** Start the UI server, begin the loop if already paired, and open the browser.
 * `onListening` receives the actual URL (the port may bump if 7420 is taken) —
 * the Electron shell uses it to load the window. */
export function startUi(opts: { port?: number; open?: boolean; onListening?: (url: string) => void } = {}): void {
  let port = opts.port ?? 7420;
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port < 7440) {
      port += 1;
      server.listen(port, "127.0.0.1");
    } else {
      console.error("UI server error:", err.message);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const addr = `http://127.0.0.1:${port}`;
    console.log(`Local Agent UI → ${addr}`);
    const cfg = loadConfig();
    if (cfg) startLoop(cfg);
    opts.onListening?.(addr);
    if (opts.open !== false) openBrowser(addr);
  });
}

// ---------------------------------------------------------------- the page
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Q-Agent · Local Agent</title>
<style>
  :root {
    --bg: #0f0f16; --panel: rgba(24,24,32,.72); --border: rgba(255,255,255,.10);
    --ink: #ececf1; --soft: #c3c3d0; --dim: #8b8b9e; --violet: #8b5cf6; --violet-2: #a78bfa;
    --green: #34d399; --red: #f43f5e; --amber: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
    background: radial-gradient(1000px 600px at 80% -10%, rgba(139,92,246,.18), transparent 60%), var(--bg);
    min-height: 100vh;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 60px; }
  .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 22px; }
  .logo { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg,#8b5cf6,#f59e0b);
    display: flex; align-items: center; justify-content: center; font-size: 20px; }
  .brand h1 { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -.02em; }
  .brand .sub { font-size: 12px; color: var(--dim); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 18px;
    margin-bottom: 16px; backdrop-filter: blur(8px); box-shadow: 0 30px 70px -30px #000; }
  .card h2 { margin: 0 0 14px; font-size: 11px; letter-spacing: .1em; color: var(--dim); font-weight: 800; }
  label { display: block; font-size: 12px; color: var(--soft); margin: 12px 0 5px; }
  input, textarea { width: 100%; background: rgba(0,0,0,.30); border: 1px solid var(--border); border-radius: 10px;
    color: var(--ink); padding: 10px 12px; font: inherit; }
  input:focus, textarea:focus { outline: none; border-color: var(--violet); }
  textarea { resize: vertical; min-height: 60px; font-family: ui-monospace, monospace; font-size: 12px; }
  button { cursor: pointer; border: none; border-radius: 10px; font: inherit; font-weight: 700; padding: 10px 16px; }
  .primary { background: linear-gradient(135deg,#8b5cf6,#7c3aed); color: #fff; }
  .primary:disabled { opacity: .6; cursor: default; }
  .ghost { background: rgba(255,255,255,.06); color: var(--soft); }
  .row { display: flex; align-items: center; gap: 10px; }
  .pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; }
  .err { color: var(--red); font-size: 12px; margin-top: 10px; min-height: 16px; }
  .mut { color: var(--dim); font-size: 12px; }
  .bar { height: 8px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; margin: 12px 0 6px; }
  .bar > i { display: block; height: 100%; background: linear-gradient(90deg,#8b5cf6,#a78bfa); width: 0; transition: width .3s; }
  .counts { display: flex; gap: 16px; font-size: 12px; }
  .banner { background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.35); color: #f6c177;
    border-radius: 10px; padding: 10px 12px; font-size: 12.5px; margin-bottom: 12px; display: none; }
  .feed { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow: auto; }
  .ev { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; padding: 7px 10px; border-radius: 9px;
    background: rgba(255,255,255,.03); }
  .ev .t { color: var(--dim); font-family: ui-monospace, monospace; font-size: 10.5px; flex-shrink: 0; }
  .ev .m { color: var(--soft); }
  .ev.pass { border-left: 2px solid var(--green); } .ev.fail { border-left: 2px solid var(--red); }
  .ev.err { border-left: 2px solid var(--red); } .ev.err .m { color: #fca5a5; }
  .badge { font-size: 10px; font-weight: 800; padding: 1px 7px; border-radius: 999px; }
  .badge.pass { background: rgba(52,211,153,.18); color: var(--green); }
  .badge.fail { background: rgba(244,63,94,.18); color: var(--red); }
  .hidden { display: none; }
  code { background: rgba(0,0,0,.3); padding: 1px 5px; border-radius: 5px; font-size: 11.5px; color: var(--violet-2); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">⭐</div>
    <div>
      <h1>Q-Agent · Local Agent</h1>
      <div class="sub">Runs Playwright on this machine — your session stays local.</div>
    </div>
    <div style="margin-left:auto"><span id="status" class="pill"><span class="dot"></span><span id="statusText">…</span></span></div>
  </div>

  <!-- Pairing -->
  <div id="pairCard" class="card hidden">
    <h2>CONNECT</h2>
    <div class="mut">Generate a pairing code on the Q-Agent app's <b>Local Agent</b> screen, then paste it here.</div>
    <label>Server URL</label>
    <input id="server" placeholder="https://your-qagent-server/api" />
    <label>Pair code</label>
    <textarea id="code" placeholder="paste the one-time pairing code"></textarea>
    <div class="err" id="pairErr"></div>
    <div class="row" style="margin-top:12px"><button id="connect" class="primary">Connect</button></div>
  </div>

  <!-- Connected -->
  <div id="connCard" class="card hidden">
    <div class="row">
      <div>
        <h2 style="margin-bottom:6px">DEVICE</h2>
        <div id="devName" style="font-weight:700"></div>
        <div class="mut" id="devServer"></div>
      </div>
      <button id="disconnect" class="ghost" style="margin-left:auto">Disconnect</button>
    </div>
  </div>

  <div id="runCard" class="card hidden">
    <h2>ACTIVITY</h2>
    <div id="banner" class="banner"></div>
    <div id="progWrap" class="hidden">
      <div class="bar"><i id="progBar"></i></div>
      <div class="counts">
        <span style="color:var(--green)">✓ <b id="cPass">0</b></span>
        <span style="color:var(--red)">✗ <b id="cFail">0</b></span>
        <span class="mut"><b id="cRem">0</b> remaining</span>
      </div>
    </div>
    <div class="feed" id="feed"></div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const time = (ts) => new Date(ts).toLocaleTimeString();

function setStatus(running, paired) {
  const dot = $("status").querySelector(".dot");
  if (!paired) { $("statusText").textContent = "Not connected"; dot.style.background = "#8b8b9e"; }
  else if (running) { $("statusText").textContent = "Running"; dot.style.background = "var(--green)"; }
  else { $("statusText").textContent = "Idle"; dot.style.background = "var(--amber)"; }
}

function addEv(ev) {
  const feed = $("feed");
  const row = document.createElement("div");
  row.className = "ev";
  let m = "";
  switch (ev.type) {
    case "job-claimed": m = \`Claimed execution #\${ev.executionId} — run \${ev.runCode} (\${ev.total} spec\${ev.total===1?"":"s"})\`; resetProgress(ev.total); break;
    case "auth-waiting": showBanner(\`A browser opened on this machine — log in to continue.\${ev.url?" ("+ev.url+")":""}\`); m = "Waiting for manual login…"; break;
    case "auth-captured": hideBanner(); m = "Login captured — session saved locally."; break;
    case "case-running": m = \`Running \${ev.index}/\${ev.total} — \${ev.ticket||""} \${ev.caseCode||""}\`; break;
    case "case-result": {
      row.className = "ev " + (ev.status === "pass" ? "pass" : "fail");
      const b = document.createElement("span"); b.className = "badge " + (ev.status==="pass"?"pass":"fail"); b.textContent = ev.status.toUpperCase();
      m = \`\${ev.ticket||""} \${ev.caseCode||""}\`;
      row.appendChild(mkTime(ev.ts)); const mm = document.createElement("span"); mm.className="m"; mm.textContent=m; row.appendChild(mm); row.appendChild(b);
      feed.prepend(row); return;
    }
    case "progress": updateProgress(ev); return;
    case "job-complete": m = \`Execution #\${ev.executionId} complete — \${ev.passed} passed, \${ev.failed} failed\`; break;
    case "agent-status": setStatus(ev.running, true); return;
    case "error": row.className = "ev err"; m = ev.message || "Error"; break;
    case "log": m = ev.message || ""; break;
    default: return;
  }
  if (!m) return;
  row.appendChild(mkTime(ev.ts));
  const mm = document.createElement("span"); mm.className = "m"; mm.textContent = m; row.appendChild(mm);
  feed.prepend(row);
}
function mkTime(ts){ const t=document.createElement("span"); t.className="t"; t.textContent=time(ts); return t; }
function resetProgress(total){ $("progWrap").classList.remove("hidden"); $("progBar").style.width="0%"; $("cPass").textContent="0"; $("cFail").textContent="0"; $("cRem").textContent=String(total||0); }
function updateProgress(ev){ $("progWrap").classList.remove("hidden"); $("progBar").style.width=(ev.progress||0)+"%"; $("cPass").textContent=ev.passed; $("cFail").textContent=ev.failed; $("cRem").textContent=ev.remaining; }
function showBanner(t){ const b=$("banner"); b.textContent=t; b.style.display="block"; }
function hideBanner(){ $("banner").style.display="none"; }

let es = null;
function openStream(){ if (es) return; es = new EventSource("/api/events"); es.onmessage = (e)=>{ try{ addEv(JSON.parse(e.data)); }catch{} }; }

async function refresh() {
  const s = await (await fetch("/api/state")).json();
  setStatus(s.running, s.paired);
  if (s.paired) {
    $("pairCard").classList.add("hidden");
    $("connCard").classList.remove("hidden"); $("runCard").classList.remove("hidden");
    $("devName").textContent = (s.deviceName||"This device") + " · #" + s.deviceId;
    $("devServer").textContent = s.serverUrl;
    $("feed").innerHTML = ""; (s.events||[]).forEach(addEv);
    openStream();
  } else {
    $("pairCard").classList.remove("hidden");
    $("connCard").classList.add("hidden"); $("runCard").classList.add("hidden");
    if (s.serverUrl) $("server").value = s.serverUrl;
  }
}

$("connect").onclick = async () => {
  const btn = $("connect"); btn.disabled = true; $("pairErr").textContent = "";
  try {
    const r = await fetch("/api/pair", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ code: $("code").value.trim(), server: $("server").value.trim() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Pairing failed");
    await refresh();
  } catch (e) { $("pairErr").textContent = e.message; }
  finally { btn.disabled = false; }
};
$("disconnect").onclick = async () => { await fetch("/api/disconnect", { method:"POST" }); if (es){es.close(); es=null;} await refresh(); };

refresh();
</script>
</body>
</html>`;
