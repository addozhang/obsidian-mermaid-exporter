// End-to-end export click: button → svgToPng → browser download PNG blob.
//
// What it does:
//   - Creates a temp mermaid note and opens it in reading mode.
//   - Intercepts `URL.createObjectURL` and `HTMLAnchorElement.prototype.click`
//     (for `mermaid-diagram-*.png` downloads) so no file is written to the
//     user's Downloads folder while still capturing the exact Blob produced by
//     `savePng`. Both globals are restored in `finally`.
//   - Programmatically clicks the export button.
//   - Verifies the captured Blob has a valid PNG header (`89 50 4E 47 0D 0A 1A 0A`)
//     and non-trivial size, and that the download filename matches
//     `mermaid-diagram-<timestamp>.png`.
//   - Cleans up the temp note.
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-export.js)"

(async () => {
  const id = "mermaid-exporter";
  const plugin = app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} not loaded`);

  const fname = `__me-e2e-export-${Date.now()}.md`;
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

  const origCreateObjectURL = URL.createObjectURL;
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  let capturedBlob = null;
  let downloadName = null;

  URL.createObjectURL = (obj) => {
    if (obj instanceof Blob && obj.type === "image/png") {
      capturedBlob = obj;
    }
    return origCreateObjectURL.call(URL, obj);
  };
  HTMLAnchorElement.prototype.click = function (...args) {
    if (typeof this.download === "string" && this.download.startsWith("mermaid-diagram-")) {
      downloadName = this.download;
      return;
    }
    return origAnchorClick.apply(this, args);
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

    await waitFor(() => capturedBlob && downloadName, 6000, 100);

    let bytes = null;
    let header = null;
    if (capturedBlob) {
      const buf = new Uint8Array(await capturedBlob.arrayBuffer());
      bytes = buf.length;
      header = Array.from(buf.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    const filenameValid = /^mermaid-diagram-\d+\.png$/.test(downloadName || "");
    const result = {
      download_name: downloadName,
      filename_valid: filenameValid,
      bytes,
      png_header_valid: header === "89504e470d0a1a0a",
      header_hex: header,
      ok:
        filenameValid &&
        !!bytes &&
        bytes > 200 &&
        header === "89504e470d0a1a0a",
    };
    return JSON.stringify(result, null, 2);
  } finally {
    URL.createObjectURL = origCreateObjectURL;
    HTMLAnchorElement.prototype.click = origAnchorClick;
    try { await app.vault.delete(file); } catch {}
  }
})()
