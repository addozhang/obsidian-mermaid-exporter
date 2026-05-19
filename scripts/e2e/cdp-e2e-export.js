// End-to-end export click: button → svgToPng → file written to disk.
//
// What it does:
//   - Creates a temp mermaid note and opens it in reading mode.
//   - Monkey-patches `window.electron.remote.dialog.showSaveDialog` to
//     return a deterministic temp path (so no native OS dialog blocks
//     the test). The original is restored in `finally`.
//   - Programmatically clicks the export button.
//   - Polls the filesystem (via Node's `fs`, which is in scope in the
//     Electron renderer) until the PNG file exists and has a non-zero
//     size with a valid PNG header.
//   - Cleans up the temp PNG and the temp note.
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-export.js)"

(async () => {
  const id = "mermaid-exporter";
  const plugin = app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} not loaded`);

  const fs = require("fs");
  const os = require("os");
  const path = require("path");

  const fname = `__me-e2e-export-${Date.now()}.md`;
  const outPath = path.join(os.tmpdir(), `me-e2e-export-${Date.now()}.png`);
  const file = await app.vault.create(
    fname,
    "# export e2e\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
  );

  const waitFor = async (fn, timeoutMs = 6000, step = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = fn();
      if (v) return v;
      await new Promise(r => setTimeout(r, step));
    }
    return null;
  };

  // Resolve electron.remote.dialog on the same window the export
  // button uses (the plugin reads it off activeWindow).
  const electron = activeWindow.electron;
  if (!electron || !electron.remote || !electron.remote.dialog) {
    throw new Error("electron.remote.dialog not available — not desktop?");
  }
  const origShowSave = electron.remote.dialog.showSaveDialog;

  const dialogCalls = [];
  electron.remote.dialog.showSaveDialog = async (opts) => {
    dialogCalls.push(opts);
    return { canceled: false, filePath: outPath };
  };

  try {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await leaf.setViewState({
      ...leaf.getViewState(),
      state: { ...leaf.view.getState(), mode: "preview" },
    });
    await new Promise(r => setTimeout(r, 600));

    const doc = leaf.view.containerEl.ownerDocument;
    const btn = await waitFor(() => doc.querySelector(".mermaid-export-btn"));
    if (!btn) throw new Error("export button never appeared");

    btn.click();

    // Wait for PNG to be written.
    let bytes = null;
    let header = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (fs.existsSync(outPath)) {
        const buf = fs.readFileSync(outPath);
        if (buf.length > 0) {
          bytes = buf.length;
          // PNG signature: 89 50 4E 47 0D 0A 1A 0A
          header = buf.slice(0, 8).toString("hex");
          if (header === "89504e470d0a1a0a") break;
        }
      }
    }

    const result = {
      dialog_invoked: dialogCalls.length,
      dialog_default_path: dialogCalls[0]?.defaultPath,
      file_written: !!bytes,
      bytes,
      png_header_valid: header === "89504e470d0a1a0a",
      header_hex: header,
      ok:
        dialogCalls.length === 1 &&
        !!bytes &&
        bytes > 200 &&
        header === "89504e470d0a1a0a",
    };
    return JSON.stringify(result, null, 2);
  } finally {
    electron.remote.dialog.showSaveDialog = origShowSave;
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
    try { await app.vault.delete(file); } catch {}
  }
})()
