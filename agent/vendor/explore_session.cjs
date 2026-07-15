// Long-lived Playwright driver for the DOM Exploration Agent (ADR 0010 §1).
//
// Vendored verbatim from api/app/services/pw_scripts/explore_session.cjs so the
// Local Agent drives the SAME observe/act/close protocol the server built. Like
// vendor/capture_auth.cjs, it `require('playwright')` — resolved against the
// agent's bundled @playwright/test via NODE_PATH (set by the spawning code in
// runner.ts), so no CDN/global Playwright is needed.
//
// Unlike the rest of the app — which drives Playwright as one-shot
// `npx playwright test` subprocesses — the exploration loop is interactive: the
// agent must OBSERVE page state after each action to DECIDE the next one. So
// this process launches ONE chromium browser + page and keeps it open for the
// whole session, reading newline-delimited JSON commands on stdin and writing
// newline-delimited JSON responses on stdout.
//
// Args: baseURL, [storageState]  (storageState = absolute path to a saved
// Playwright session for auth reuse, per ADR 0002).
//
// Protocol (one JSON object per line, each way):
//   {"cmd":"observe"}
//     -> {"ok":true,"url":..,"path":..,"a11y":<ariaSnapshot() role+name tree>,
//         "elements":[<distilled interactive DOM>]}
//   {"cmd":"act","action":"goto|click|fill|expectVisible","args":{...}}
//     -> {"ok":bool,"error":str|null,"changed":bool}
//   {"cmd":"close"}  -> process exits.
//
// Every command is guarded so a bad action returns {ok:false,error} and never
// crashes the process (the session must survive a mis-step, mirroring the
// self-heal loop's tolerance for stale actions).
const { chromium } = require('playwright');
const readline = require('readline');

const [, , baseURL, storageState] = process.argv;

process.on('unhandledRejection', (e) => console.error('explore unhandledRejection:', e && (e.message || e)));
process.on('uncaughtException', (e) => console.error('explore uncaughtException:', e && (e.message || e)));

// Same selector set + shape as the self-heal distilled DOM (playwright_runner
// `_fixtures_ts`), so observations ground on identical real identifiers.
const DISTILL = () => {
  const SEL = 'a,button,input,select,textarea,[role],[data-testid],[data-test],[id]';
  return Array.from(document.querySelectorAll(SEL)).slice(0, 400).map((node) => {
    const el = node;
    const text = (el.innerText || '').trim().slice(0, 80);
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined,
      id: el.id || undefined,
      name: el.getAttribute('name') || undefined,
      text: text || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      type: el.getAttribute('type') || undefined,
    };
  });
};

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let browser = null;
let page = null;

/**
 * Resolve a Playwright locator from the action args. Prefers stable strategies:
 * data-testid -> role -> raw selector (CSS/testid). Returns null when the args
 * carry neither a role nor a selector.
 */
function locatorFor(args) {
  if (!args) return null;
  if (args.testId) return page.getByTestId(args.testId);
  if (args.role) return page.getByRole(args.role, args.name != null ? { name: args.name } : undefined);
  if (args.selector) return page.locator(args.selector);
  return null;
}

/** A cheap page signature (url + distilled interactive DOM) used to detect change. */
async function signature() {
  try {
    const elements = await page.evaluate(DISTILL);
    return page.url() + '::' + JSON.stringify(elements);
  } catch {
    return page.url() + '::';
  }
}

async function doAct(action, args) {
  args = args || {};
  const before = await signature();
  switch (action) {
    case 'goto': {
      await page.goto(args.url, { waitUntil: 'domcontentloaded' });
      break;
    }
    case 'click': {
      const loc = locatorFor(args);
      if (!loc) return { ok: false, error: 'click needs role+name or selector', changed: false };
      await loc.first().click();
      break;
    }
    case 'fill': {
      const loc = locatorFor(args);
      if (!loc) return { ok: false, error: 'fill needs role+name or selector', changed: false };
      await loc.first().fill(args.value != null ? String(args.value) : '');
      break;
    }
    case 'expectVisible': {
      // Probe only — report visibility, never throw on absence.
      const loc = locatorFor(args);
      if (!loc) return { ok: false, error: 'expectVisible needs role+name or selector', changed: false };
      let visible = false;
      try { visible = await loc.first().isVisible(); } catch { visible = false; }
      return { ok: visible, error: visible ? null : 'not visible', changed: false };
    }
    default:
      return { ok: false, error: `unknown action: ${action}`, changed: false };
  }
  const after = await signature();
  return { ok: true, error: null, changed: after !== before };
}

async function doObserve() {
  // Playwright removed page.accessibility; the supported role+name tree is
  // locator.ariaSnapshot() (a compact YAML string, ideal for the model and
  // maps directly to getByRole). Best-effort — never fail observe on it.
  let a11y = '';
  try { a11y = await page.locator('body').ariaSnapshot(); } catch { a11y = ''; }
  const elements = await page.evaluate(DISTILL);
  const url = page.url();
  let path = '';
  try { path = new URL(url).pathname; } catch { path = ''; }
  return { ok: true, url, path, a11y, elements };
}

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    send({ ok: false, error: 'invalid JSON command' });
    return;
  }
  try {
    if (msg.cmd === 'observe') {
      send(await doObserve());
    } else if (msg.cmd === 'act') {
      send(await doAct(msg.action, msg.args));
    } else if (msg.cmd === 'close') {
      try { await browser.close(); } catch {}
      process.exit(0);
    } else {
      send({ ok: false, error: `unknown cmd: ${msg.cmd}` });
    }
  } catch (e) {
    send({ ok: false, error: (e && (e.message || String(e))) || 'command failed' });
  }
}

(async () => {
  if (!baseURL) { console.error('explore_session: missing baseURL arg'); process.exit(1); }
  // Headed when QAGENT_EXPLORE_HEADED=1 (the Local Agent sets it so the user can
  // watch, and a headed browser trips WAF/bot-protection far less than headless);
  // headless otherwise (e.g. the server, which has no display).
  browser = await chromium.launch({ headless: process.env.QAGENT_EXPLORE_HEADED !== '1' });
  const contextOpts = { baseURL };
  if (storageState) contextOpts.storageState = storageState;
  const context = await browser.newContext(contextOpts);
  page = await context.newPage();

  // Land on the app before the first observe so step 1 sees the real page,
  // not about:blank. Best-effort — the model can still goto elsewhere.
  if (baseURL) {
    try { await page.goto(baseURL, { waitUntil: 'domcontentloaded' }); } catch {}
  }

  // Serialize commands: one line in -> one response out, in order.
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(() => handle(line));
  });
  rl.on('close', async () => {
    try { await browser.close(); } catch {}
    process.exit(0);
  });
  // Signal readiness so the agent side knows the browser+page are up.
  send({ ok: true, ready: true });
})().catch((e) => {
  console.error('explore_session fatal:', e && (e.stack || e.message || e));
  process.exit(1);
});
