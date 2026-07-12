# Q-Agent · Local Agent

Self-contained desktop window for pairing a machine with a Q-Agent server and
running Playwright locally. Styled in the Q-Agent design language (dark theme,
purple→indigo accents, glass panels).

## Contents

```
Local Agent/
├─ Local Agent.dc.html          # the screen (Design Component source)
├─ Local Agent (standalone).html # single-file build — works offline, drop into Electron
├─ support.js                    # runtime the .dc.html loads
└─ icons/
   ├─ icon.svg                   # vector app mark
   ├─ icon-16.png … icon-512.png # raster app icons (16/32/48/64/128/256/512)
```

## Screen states

The window drives the full local-agent lifecycle (switch with the bottom-left
control while developing):

- **Not connected** — Server URL + one-time pair code form.
- **Connecting** — inline spinner in the Connect button; the form stays visible.
- **Connected · Live** — session metadata, Playwright browser workers, live agent log.

## Using in Electron

Point the renderer window at the standalone build:

```js
const win = new BrowserWindow({
  width: 420,
  height: 560,
  frame: false,              // custom titlebar is drawn in the screen
  backgroundColor: '#0a0a0f',
  icon: 'icons/icon-256.png'
});
win.loadFile('Local Agent/Local Agent (standalone).html');
```

Wire the titlebar min / max / close buttons and the Connect / Disconnect
handlers to your IPC / pairing logic.

## App icon

Use `icons/icon.svg` as the source of truth. Windows builds want a multi-size
`.ico`; generate it from the PNGs, e.g. `icon-16/32/48/256.png`.
