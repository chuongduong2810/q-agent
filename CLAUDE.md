# CLAUDE.md — Q-Agent

Project-specific guidelines. Merge with the global `~/.claude/CLAUDE.md`.

## Debugging

- For visual layering/rendering bugs, inspect the live DOM (e.g. `elementFromPoint`, computed styles) to find the actual cause **before** fixing. Don't iterate on opacity/z-index guesses.

## Frontend (React / Tailwind / Framer Motion)

- Render floating overlays (dropdowns, popovers, tooltips, menus) via a portal to `document.body` with fixed positioning anchored to the trigger's bounding rect. Ancestor `backdrop-filter`/`transform`/`filter` create stacking contexts that trap child `z-index`.
- Don't use `backdrop-filter` on panels layered over animated content; use an opaque background. Animated backdrops cause compositing artifacts and the filter itself creates a stacking-context trap.
- When portalling a Framer Motion element, call `createPortal` on the outside and let `AnimatePresence` directly wrap the `motion` element inside — `AnimatePresence` must be the direct parent of the animating child, or it won't mount/animate.

## Tooling

- In the Bash tool, use bash heredocs for multi-line commit messages; never use PowerShell here-string syntax (`@'...'@`) — it leaks literal characters into the message.
