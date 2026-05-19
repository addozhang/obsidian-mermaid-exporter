# CDP-based End-to-End Tests

These scripts drive a real Obsidian instance over the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) to validate the plugin against real mermaid rendering, real popout windows, and a real Electron save dialog. Use them when:

- You touched `src/main.ts`, `src/exportButton.ts`, or `src/svgToPng.ts` and want to confirm Obsidian still injects the export button and produces a valid PNG.
- You want to verify the acceptance criteria for [#4 (popout windows)](https://github.com/addozhang/obsidian-mermaid-exporter/issues/4) and [#5 (no global MutationObserver)](https://github.com/addozhang/obsidian-mermaid-exporter/issues/5).
- You suspect an Electron-specific runtime issue that pure unit tests can't catch (e.g. mermaid's async SVG render timing, ownerDocument differences between popouts and the main window).

These are intentionally **not** wired into CI — they require a running Obsidian instance, a vault with the plugin installed, and access to the desktop electron remote.

## Prerequisites

- Obsidian (desktop) launched with the CDP endpoint enabled:

  ```bash
  open -a Obsidian --args --remote-debugging-port=9223
  ```

- The plugin built and installed into the vault you intend to test:

  ```bash
  npm run build
  cp main.js manifest.json styles.css \
    "/path/to/your/vault/.obsidian/plugins/mermaid-exporter/"
  ```

  Then hot-reload it via CDP (see [Plugin reload](#plugin-reload-via-cdp) below) — no need to restart Obsidian.

- `websocat` and `python3` on `PATH`:

  ```bash
  brew install websocat
  ```

## The helper

[`cdp.sh`](./cdp.sh) wraps a single `Runtime.evaluate` call to the active page. Pass any JavaScript expression as the first argument; the expression runs in the Obsidian renderer with full access to `app`, `app.plugins`, `app.vault`, `activeDocument`, `activeWindow`, `require("fs")`, etc.

```bash
# Inline expression
./scripts/e2e/cdp.sh 'app.plugins.plugins["mermaid-exporter"].manifest.version'

# Load a script file
./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-all.js)"

# Custom port
PORT=9333 ./scripts/e2e/cdp.sh '...'
```

Multi-statement scripts must be wrapped in an `async` IIFE that returns a JSON-serializable value, because `awaitPromise: true` is passed and the result is fetched via `returnByValue: true`.

## Scripts

| File | Purpose |
|---|---|
| [`cdp.sh`](./cdp.sh) | Generic `Runtime.evaluate` helper. |
| [`cdp-reload.js`](./cdp-reload.js) | Disable + re-enable the plugin to pick up a fresh `main.js`. Run after every `npm run build` + copy. |
| [`cdp-e2e-architecture.js`](./cdp-e2e-architecture.js) | Asserts the post-refactor invariants for issue #5: no `observer` field on the plugin instance, no `MutationObserver` / `.observe(` in the shipped bundle, `processMermaidBlocks` is reachable. |
| [`cdp-e2e-reading-mode.js`](./cdp-e2e-reading-mode.js) | Creates a temp mermaid note, opens it, switches between Live Preview and Reading mode, asserts the export button is injected in both. |
| [`cdp-e2e-popout.js`](./cdp-e2e-popout.js) | Covers issue #4 acceptance: (a) open note then `moveLeafToPopout` — button appears in the popout document; (b) open popout first, then open the note in it — button still appears. Both confirm the editor-extension-per-view design follows popouts automatically. |
| [`cdp-e2e-export.js`](./cdp-e2e-export.js) | Monkey-patches `electron.remote.dialog.showSaveDialog` to return a deterministic temp path, clicks the export button, polls until a valid PNG (with `89 50 4E 47` header) is written to disk, then restores the dialog. |
| [`cdp-e2e-all.js`](./cdp-e2e-all.js) | Runs all of the above in one round-trip and returns a combined JSON summary with a single top-level `ok` boolean. Preferred for routine runs. |

Each script has a header comment block documenting what it does and any caveats.

## Plugin reload via CDP

After copying a new build into the vault:

```bash
./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-reload.js)"
```

This is faster than restarting Obsidian and clears all stale state (CodeMirror extensions are re-registered, post-processors are re-bound).

## Typical workflow

```bash
# 1. Build.
npm run build

# 2. Copy into your test vault (adjust the path).
VAULT="$HOME/iCloud Drive/MyVault"   # or wherever your vault lives
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/mermaid-exporter/"

# 3. Hot-reload.
./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-reload.js)"

# 4. Run the full suite.
./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-all.js)"
```

A successful run prints something like:

```json
{
  "plugin_version": "1.0.5",
  "results": {
    "architecture": { "ok": true, ... },
    "reading_and_live_preview": { "ok": true, ... },
    "popout": { "ok": true, ... },
    "export_click": { "ok": true, "bytes": 12453, "png_header_valid": true, ... }
  },
  "ok": true
}
```

## Footguns worth knowing

- **`require("obsidian")` and dynamic `import()` of the bundle don't work** inside CDP — `obsidian` is an esbuild external and resolves to nothing at runtime in this context. Use the plugin instance (`app.plugins.plugins["mermaid-exporter"]`) for everything you need from the API.
- **Mermaid renders the SVG asynchronously.** Every assertion that looks at a rendered diagram must `waitFor` the SVG / button instead of querying once. The helper pattern is in every script.
- **`ownerDocument` differs between popouts and the main window.** Always query off `leaf.view.containerEl.ownerDocument`, never `document` / `activeDocument` — `activeDocument` resolves to whichever window is focused at call time, which is exactly the bug we fixed in #4.
- **The export flow needs the Electron remote.** Tests that exercise the export click monkey-patch `activeWindow.electron.remote.dialog.showSaveDialog` to skip the native OS dialog. Always restore it in `finally`.
- **macOS TCC blocks `~/Documents`** for non-Obsidian processes; if you run scripts that touch vault files outside Obsidian's adapter, place your test vault under `~/iCloud Drive/` or another accessible location.
- **Don't call command `callback` directly.** This plugin doesn't register any commands, but in general use `app.commands.executeCommandById(...)` rather than poking `.callback`.

## Cleanup expectations

All scripts:

- Prefix temp notes with `__me-e2e-` so they are easy to identify and prune.
- Delete temp notes via `app.vault.delete(file)` in a `finally` block.
- Delete temp PNGs from `os.tmpdir()` in a `finally` block.
- Restore any monkey-patched globals (e.g. `electron.remote.dialog.showSaveDialog`) in a `finally` block.

If a script crashes mid-run, residual `__me-e2e-*.md` files in your vault are harmless to delete by hand.
