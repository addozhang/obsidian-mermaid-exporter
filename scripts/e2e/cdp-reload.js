// Hot-reload the plugin after copying a fresh build into the vault.
//
// Usage:
//   ./scripts/e2e/cdp.sh "$(cat scripts/e2e/cdp-reload.js)"

(async () => {
  const id = "mermaid-exporter";
  await app.plugins.disablePlugin(id);
  await app.plugins.enablePlugin(id);
  const p = app.plugins.plugins[id];
  if (!p) throw new Error("plugin failed to reload");
  return JSON.stringify({
    id,
    version: p.manifest.version,
    loaded: true,
  }, null, 2);
})()
