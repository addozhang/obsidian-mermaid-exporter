// Architecture invariants for the post-MutationObserver refactor.
//
// What it asserts (issue #5):
//   - The plugin instance no longer exposes a long-lived `observer` field.
//   - The plugin source bundle does not call `.observe(` on
//     `document.body` or `activeDocument.body` (the global-observer
//     anti-pattern). A short-lived MutationObserver scoped to a single
//     post-processor `el` is still allowed — it auto-disconnects on
//     first hit or after a 5s budget and does not contribute to
//     plugin-wide mutation traffic.
//   - `processMermaidBlocks` is reachable on the plugin instance
//     (used by both the post-processor and the CodeMirror ViewPlugin).
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-e2e-architecture.js)"

(async () => {
  const id = "mermaid-exporter";
  const plugin = app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} not loaded`);

  const result = {
    plugin_version: plugin.manifest.version,
    checks: {},
  };

  // 1. No long-lived `observer` field on the plugin instance.
  result.checks.no_observer_field = {
    pass: !("observer" in plugin),
    actual: "observer" in plugin ? typeof plugin.observer : "absent",
  };

  // 2. Bundle source does not attach an observer to `document.body`
  //    or `activeDocument.body` (the anti-pattern from #5).
  try {
    const adapter = app.vault.adapter;
    const manifestDir = plugin.manifest.dir || `.obsidian/plugins/${id}`;
    const bundle = await adapter.read(`${manifestDir}/main.js`);
    const observesDocBody = /\.observe\s*\(\s*[^,]*document[^,]*\.body/.test(bundle);
    const observesActiveDocBody = /\.observe\s*\(\s*activeDocument\.body/.test(bundle);
    result.checks.bundle_has_no_global_observer = {
      pass: !observesDocBody && !observesActiveDocBody,
      bundle_size: bundle.length,
      matched_document_body: observesDocBody,
      matched_activeDocument_body: observesActiveDocBody,
    };
  } catch (e) {
    result.checks.bundle_has_no_global_observer = {
      pass: false,
      error: String(e),
    };
  }

  // 3. Method exposed for both injection paths.
  result.checks.processMermaidBlocks_exposed = {
    pass: typeof plugin.processMermaidBlocks === "function",
    actual: typeof plugin.processMermaidBlocks,
  };

  result.ok = Object.values(result.checks).every((c) => c.pass);
  return JSON.stringify(result, null, 2);
})()

