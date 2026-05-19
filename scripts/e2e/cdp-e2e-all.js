// Run all e2e scripts in sequence and print a combined summary.
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-all.js)"
//
// Note: this file inlines the other scripts' bodies; if you change one,
// keep this in sync. Kept as a single round-trip so we don't pay the
// websocat handshake cost per check.

(async () => {
  const id = "mermaid-exporter";
  const plugin = app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} not loaded`);

  const summary = {
    plugin_version: plugin.manifest.version,
    run_at: new Date().toISOString(),
    results: {},
  };

  const waitFor = async (fn, timeoutMs = 6000, step = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = fn();
      if (v) return v;
      await new Promise(r => setTimeout(r, step));
    }
    return null;
  };

  // === architecture invariants ===
  // Issue #5's goal is "no plugin-wide observer on document.body",
  // not "no MutationObserver anywhere in the bundle" — we still use
  // a short-lived per-element observer in reading mode to catch
  // Obsidian's async mermaid render. So we grep for the specific
  // anti-patterns instead.
  try {
    const adapter = app.vault.adapter;
    const manifestDir = plugin.manifest.dir || `.obsidian/plugins/${id}`;
    const bundle = await adapter.read(`${manifestDir}/main.js`);
    const observesBody = /\.observe\s*\(\s*[^,]*document[^,]*\.body/.test(bundle);
    const observesActiveDoc = /\.observe\s*\(\s*activeDocument\.body/.test(bundle);
    summary.results.architecture = {
      no_observer_field: !("observer" in plugin),
      bundle_observes_document_body: observesBody,
      bundle_observes_activeDocument_body: observesActiveDoc,
      processMermaidBlocks_method: typeof plugin.processMermaidBlocks,
      bundle_size: bundle.length,
    };
    summary.results.architecture.ok =
      summary.results.architecture.no_observer_field &&
      !observesBody &&
      !observesActiveDoc &&
      summary.results.architecture.processMermaidBlocks_method === "function";
  } catch (e) {
    summary.results.architecture = { ok: false, error: String(e) };
  }

  // === reading mode + live preview ===
  {
    const fname = `__me-e2e-read-${Date.now()}.md`;
    const file = await app.vault.create(
      fname,
      "# read\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
    );
    try {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      // Live preview
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "source", source: false } });
      await new Promise(r => setTimeout(r, 700));
      const lpDoc = leaf.view.containerEl.ownerDocument;
      const lpBtn = await waitFor(() => lpDoc.querySelector(".mermaid-export-btn"));
      // Reading
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "preview" } });
      await new Promise(r => setTimeout(r, 700));
      const rmDoc = leaf.view.containerEl.ownerDocument;
      const rmBtn = await waitFor(() => rmDoc.querySelector(".markdown-preview-view .mermaid-export-btn"));
      summary.results.reading_and_live_preview = {
        live_preview_button: !!lpBtn,
        reading_mode_button: !!rmBtn,
        ok: !!lpBtn && !!rmBtn,
      };
    } catch (e) {
      summary.results.reading_and_live_preview = { ok: false, error: String(e) };
    } finally {
      try { await app.vault.delete(file); } catch {}
    }
  }

  // === popout window ===
  {
    const fname = `__me-e2e-pop-${Date.now()}.md`;
    const file = await app.vault.create(
      fname,
      "# pop\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
    );
    let leaf = null;
    try {
      leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "preview" } });
      await new Promise(r => setTimeout(r, 600));
      app.workspace.moveLeafToPopout(leaf);
      await new Promise(r => setTimeout(r, 900));
      const popDoc = leaf.view.containerEl.ownerDocument;
      const distinct = popDoc !== window.document;
      const btn = await waitFor(() => popDoc.querySelector(".mermaid-export-btn"));
      summary.results.popout = {
        popout_document_distinct: distinct,
        button_in_popout: !!btn,
        ok: distinct && !!btn,
      };
    } catch (e) {
      summary.results.popout = { ok: false, error: String(e) };
    } finally {
      try { if (leaf) leaf.detach(); } catch {}
      try { await app.vault.delete(file); } catch {}
    }
  }

  // === export click → PNG on disk ===
  {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const fname = `__me-e2e-export-${Date.now()}.md`;
    const outPath = path.join(os.tmpdir(), `me-e2e-export-${Date.now()}.png`);
    const file = await app.vault.create(
      fname,
      "# export\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
    );
    const electron = activeWindow.electron;
    const origShowSave = electron?.remote?.dialog?.showSaveDialog;
    let dialogCalls = 0;
    if (electron?.remote?.dialog) {
      electron.remote.dialog.showSaveDialog = async () => {
        dialogCalls++;
        return { canceled: false, filePath: outPath };
      };
    }
    try {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "preview" } });
      await new Promise(r => setTimeout(r, 700));
      const doc = leaf.view.containerEl.ownerDocument;
      const btn = await waitFor(() => doc.querySelector(".mermaid-export-btn"));
      if (!btn) throw new Error("export button never appeared");
      btn.click();
      let bytes = null, header = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (fs.existsSync(outPath)) {
          const buf = fs.readFileSync(outPath);
          if (buf.length > 0) {
            bytes = buf.length;
            header = buf.slice(0, 8).toString("hex");
            if (header === "89504e470d0a1a0a") break;
          }
        }
      }
      summary.results.export_click = {
        dialog_invoked: dialogCalls,
        bytes,
        png_header_valid: header === "89504e470d0a1a0a",
        ok: dialogCalls === 1 && !!bytes && bytes > 200 && header === "89504e470d0a1a0a",
      };
    } catch (e) {
      summary.results.export_click = { ok: false, error: String(e) };
    } finally {
      if (electron?.remote?.dialog && origShowSave) {
        electron.remote.dialog.showSaveDialog = origShowSave;
      }
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
      try { await app.vault.delete(file); } catch {}
    }
  }

  summary.ok = Object.values(summary.results).every(r => r && r.ok);
  return JSON.stringify(summary, null, 2);
})()
