// Popout-window coverage (issue #4 acceptance).
//
// What it does:
//   - Creates a temp mermaid note.
//   - Opens it, then moves the leaf into a new popout window via
//     `workspace.moveLeafToPopout(leaf)`.
//   - Asserts the export button appears in the popout's document
//     (not the main document) — the ViewPlugin-per-editor design
//     means popouts work automatically.
//   - Also performs the reverse: creates a popout first, then a
//     mermaid note in it, asserting button injection still works.
//   - Closes the popout and deletes the note.
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-popout.js)"

(async () => {
  const id = "mermaid-exporter";
  const plugin = app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} not loaded`);

  const waitFor = async (fn, timeoutMs = 6000, step = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = fn();
      if (v) return v;
      await new Promise(r => setTimeout(r, step));
    }
    return null;
  };

  const result = { case_a_open_then_popout: {}, case_b_popout_then_open: {} };

  // --- Case A: open mermaid note, then pop the leaf out ---
  const fnameA = `__me-e2e-pop-a-${Date.now()}.md`;
  const fileA = await app.vault.create(
    fnameA,
    "# popout A\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
  );
  let leafA = null;
  try {
    leafA = app.workspace.getLeaf(false);
    await leafA.openFile(fileA);
    await leafA.setViewState({ ...leafA.getViewState(), state: { ...leafA.view.getState(), mode: "preview" } });
    await new Promise(r => setTimeout(r, 600));

    // Pop the leaf out.
    app.workspace.moveLeafToPopout(leafA);
    await new Promise(r => setTimeout(r, 800));

    // The leaf now lives in a different window. Find it.
    const popoutDoc = leafA.view.containerEl.ownerDocument;
    const sameAsMain = popoutDoc === activeDocument && popoutDoc === window.document;
    const svg = await waitFor(() => popoutDoc.querySelector(".mermaid svg, .block-language-mermaid svg, .cm-preview-code-block svg"));
    const btn = await waitFor(() => popoutDoc.querySelector(".mermaid-export-btn"));

    result.case_a_open_then_popout = {
      popout_document_distinct: !sameAsMain,
      svg_rendered_in_popout: !!svg,
      button_attached_in_popout: !!btn,
      pass: !sameAsMain && !!svg && !!btn,
    };
  } finally {
    try { if (leafA) leafA.detach(); } catch {}
    try { await app.vault.delete(fileA); } catch {}
  }

  // --- Case B: open empty popout first, then create mermaid note inside ---
  const fnameB = `__me-e2e-pop-b-${Date.now()}.md`;
  const fileB = await app.vault.create(
    fnameB,
    "# popout B\n\n```mermaid\nflowchart LR\n  X-->Y\n```\n"
  );
  let leafB = null;
  try {
    // Open empty leaf and pop it out first.
    leafB = app.workspace.getLeaf(true);
    app.workspace.moveLeafToPopout(leafB);
    await new Promise(r => setTimeout(r, 600));

    // Then load the mermaid file into it.
    await leafB.openFile(fileB);
    await leafB.setViewState({ ...leafB.getViewState(), state: { ...leafB.view.getState(), mode: "preview" } });
    await new Promise(r => setTimeout(r, 800));

    const popoutDoc = leafB.view.containerEl.ownerDocument;
    const sameAsMain = popoutDoc === activeDocument && popoutDoc === window.document;
    const svg = await waitFor(() => popoutDoc.querySelector(".mermaid svg, .block-language-mermaid svg, .cm-preview-code-block svg"));
    const btn = await waitFor(() => popoutDoc.querySelector(".mermaid-export-btn"));

    result.case_b_popout_then_open = {
      popout_document_distinct: !sameAsMain,
      svg_rendered_in_popout: !!svg,
      button_attached_in_popout: !!btn,
      pass: !sameAsMain && !!svg && !!btn,
    };
  } finally {
    try { if (leafB) leafB.detach(); } catch {}
    try { await app.vault.delete(fileB); } catch {}
  }

  result.ok =
    result.case_a_open_then_popout.pass &&
    result.case_b_popout_then_open.pass;
  return JSON.stringify(result, null, 2);
})()
