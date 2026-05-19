// Reading-mode + Live-Preview button injection smoke test.
//
// What it does:
//   - Creates a temp note containing a single mermaid fence.
//   - Opens it in a leaf (Live Preview by default).
//   - Polls for the rendered mermaid SVG and asserts an export button
//     was attached.
//   - Switches the leaf to Reading mode and re-asserts.
//   - Cleans up the temp note.
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-reading-mode.js)"

(async () => {
  const id = "mermaid-exporter";
  const plugin = app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} not loaded`);

  const fname = `__me-e2e-read-${Date.now()}.md`;
  const content = "# E2E reading\n\n```mermaid\nflowchart LR\n  A-->B\n  B-->C\n```\n";
  const file = await app.vault.create(fname, content);

  const waitFor = async (selectorFn, timeoutMs = 5000, step = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = selectorFn();
      if (v) return v;
      await new Promise(r => setTimeout(r, step));
    }
    return null;
  };

  const result = { live_preview: {}, reading_mode: {} };

  try {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);

    // --- Live Preview ---
    // Force source/live state (Obsidian default is live for new leaves).
    await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "source", source: false } });
    await new Promise(r => setTimeout(r, 600));

    const lpDoc = leaf.view.containerEl.ownerDocument;
    const lpSvg = await waitFor(() => lpDoc.querySelector(".cm-preview-code-block svg, .block-language-mermaid svg"));
    const lpBtn = await waitFor(() => lpDoc.querySelector(".cm-preview-code-block .mermaid-export-btn, .block-language-mermaid .mermaid-export-btn"));
    result.live_preview = {
      svg_rendered: !!lpSvg,
      button_attached: !!lpBtn,
      button_count: lpDoc.querySelectorAll(".mermaid-export-btn").length,
      pass: !!lpSvg && !!lpBtn,
    };

    // --- Reading Mode ---
    await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "preview" } });
    await new Promise(r => setTimeout(r, 600));

    const rmDoc = leaf.view.containerEl.ownerDocument;
    const rmSvg = await waitFor(() => rmDoc.querySelector(".markdown-preview-view .mermaid svg, .markdown-preview-view .block-language-mermaid svg"));
    const rmBtn = await waitFor(() => rmDoc.querySelector(".markdown-preview-view .mermaid-export-btn"));
    result.reading_mode = {
      svg_rendered: !!rmSvg,
      button_attached: !!rmBtn,
      button_count: rmDoc.querySelectorAll(".markdown-preview-view .mermaid-export-btn").length,
      pass: !!rmSvg && !!rmBtn,
    };

    result.ok = result.live_preview.pass && result.reading_mode.pass;
    return JSON.stringify(result, null, 2);
  } finally {
    try { await app.vault.delete(file); } catch {}
  }
})()
