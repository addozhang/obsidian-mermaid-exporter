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

  // === export click + copy + scale + theme ===
  {
    const fname = `__me-e2e-export-${Date.now()}.md`;
    const file = await app.vault.create(
      fname,
      "# export\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
    );
    const origCreateObjectURL = URL.createObjectURL;
    const origAnchorClick = HTMLAnchorElement.prototype.click;
    const origScale = plugin.settings.scale;
    const origTheme = plugin.settings.theme;
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

    const readPngInfo = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const header = Array.from(buf.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const width = buf.length >= 24 ? view.getUint32(16) : 0;
      const height = buf.length >= 24 ? view.getUint32(20) : 0;
      return { bytes: buf.length, header, width, height };
    };

    const sampleCornerPixel = async (blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };

    const triggerExport = async (btn) => {
      capturedBlob = null;
      downloadName = null;
      btn.click();
      await waitFor(() => capturedBlob && downloadName, 6000, 50);
      if (!capturedBlob) throw new Error("PNG blob was not captured");
      return { blob: capturedBlob, downloadName };
    };

    try {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "preview" } });
      await new Promise(r => setTimeout(r, 700));
      const doc = leaf.view.containerEl.ownerDocument;
      const exportBtn = await waitFor(() => doc.querySelector('[aria-label="Export as PNG"]'));
      const copyBtn = await waitFor(() => doc.querySelector('[aria-label="Copy image to clipboard"]'));
      if (!exportBtn) throw new Error("export button never appeared");
      if (!copyBtn) throw new Error("copy button never appeared");

      // 1. Default export click
      {
        const { blob, downloadName: name } = await triggerExport(exportBtn);
        const info = await readPngInfo(blob);
        const filenameValid = /^mermaid-diagram-\d+\.png$/.test(name || "");
        summary.results.export_click = {
          download_name: name,
          filename_valid: filenameValid,
          bytes: info.bytes,
          width: info.width,
          height: info.height,
          png_header_valid: info.header === "89504e470d0a1a0a",
          ok: filenameValid && info.bytes > 200 && info.header === "89504e470d0a1a0a",
        };
      }

      // 2. Copy to clipboard (intercepted so user's real clipboard stays untouched)
      {
        const electron = activeWindow.electron;
        const origWriteImage = electron?.clipboard?.writeImage;
        let capturedImage = null;
        if (electron?.clipboard && origWriteImage) {
          electron.clipboard.writeImage = (img) => {
            capturedImage = img;
          };
        }
        try {
          copyBtn.click();
          await waitFor(() => capturedImage, 6000, 50);
          const isEmpty = capturedImage ? capturedImage.isEmpty() : true;
          const size = capturedImage ? capturedImage.getSize() : { width: 0, height: 0 };
          const pngBuf = capturedImage ? capturedImage.toPNG() : null;
          const header = pngBuf
            ? Array.from(pngBuf.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("")
            : null;
          summary.results.copy_to_clipboard = {
            captured: !!capturedImage,
            width: size.width,
            height: size.height,
            bytes: pngBuf ? pngBuf.length : 0,
            png_header_valid: header === "89504e470d0a1a0a",
            ok:
              !!capturedImage &&
              !isEmpty &&
              size.width > 0 &&
              size.height > 0 &&
              header === "89504e470d0a1a0a",
          };
        } finally {
          if (electron?.clipboard && origWriteImage) {
            electron.clipboard.writeImage = origWriteImage;
          }
        }
      }

      // 3. Resolution scaling (1x vs 2x)
      {
        plugin.settings.scale = 1;
        const exp1 = await triggerExport(exportBtn);
        const info1 = await readPngInfo(exp1.blob);

        plugin.settings.scale = 2;
        const exp2 = await triggerExport(exportBtn);
        const info2 = await readPngInfo(exp2.blob);

        summary.results.scale_setting = {
          scale_1x: { width: info1.width, height: info1.height },
          scale_2x: { width: info2.width, height: info2.height },
          ok:
            info1.width > 0 &&
            info1.height > 0 &&
            info2.width === info1.width * 2 &&
            info2.height === info1.height * 2,
        };
      }

      // 4. Export theme (light vs dark background pixels on Pele)
      {
        const svg = doc.querySelector(".markdown-preview-view .mermaid svg, .markdown-preview-view .block-language-mermaid svg");
        const isPele = !!svg?.classList.contains("pele");
        plugin.settings.scale = 1;

        plugin.settings.theme = "light";
        const lightExp = await triggerExport(exportBtn);
        const lightPx = await sampleCornerPixel(lightExp.blob);

        plugin.settings.theme = "dark";
        const darkExp = await triggerExport(exportBtn);
        const darkPx = await sampleCornerPixel(darkExp.blob);

        const lightIsWhite = lightPx.r >= 245 && lightPx.g >= 245 && lightPx.b >= 245;
        const darkIsDark = darkPx.r <= 40 && darkPx.g <= 40 && darkPx.b <= 40;
        summary.results.theme_setting = {
          renderer: isPele ? "pele" : "legacy-mermaid",
          light_corner_rgb: [lightPx.r, lightPx.g, lightPx.b],
          dark_corner_rgb: [darkPx.r, darkPx.g, darkPx.b],
          ok: isPele ? lightIsWhite && darkIsDark : lightExp.blob.size > 200 && darkExp.blob.size > 200,
        };
      }
    } catch (e) {
      summary.results.export_click = summary.results.export_click || { ok: false, error: String(e) };
    } finally {
      plugin.settings.scale = origScale;
      plugin.settings.theme = origTheme;
      URL.createObjectURL = origCreateObjectURL;
      HTMLAnchorElement.prototype.click = origAnchorClick;
      try { await app.vault.delete(file); } catch {}
    }
  }

  // === disable / onunload cleanup + re-enable ===
  {
    const fname = `__me-e2e-unload-${Date.now()}.md`;
    const file = await app.vault.create(
      fname,
      "# unload\n\n```mermaid\nflowchart LR\n  A-->B\n```\n"
    );
    try {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.view.getState(), mode: "preview" } });
      await new Promise(r => setTimeout(r, 700));
      const doc = leaf.view.containerEl.ownerDocument;
      const beforeBtn = await waitFor(() => doc.querySelector(".mermaid-export-btn"));

      await app.plugins.disablePlugin(id);
      await new Promise(r => setTimeout(r, 200));

      const remainingBtns = doc.querySelectorAll(".mermaid-export-btns").length;
      const remainingHosts = doc.querySelectorAll(".mermaid-export-host, .mermaid-export-host-static").length;
      const remainingMarkers = doc.querySelectorAll("[data-mermaid-export]").length;

      await app.plugins.enablePlugin(id);
      await new Promise(r => setTimeout(r, 300));
      const reenabled = !!app.plugins.plugins[id];

      summary.results.unload_cleanup = {
        had_button_before: !!beforeBtn,
        remaining_btns_after_disable: remainingBtns,
        remaining_hosts_after_disable: remainingHosts,
        remaining_markers_after_disable: remainingMarkers,
        reenabled,
        ok:
          !!beforeBtn &&
          remainingBtns === 0 &&
          remainingHosts === 0 &&
          remainingMarkers === 0 &&
          reenabled,
      };
    } catch (e) {
      summary.results.unload_cleanup = { ok: false, error: String(e) };
      try { await app.plugins.enablePlugin(id); } catch {}
    } finally {
      try { await app.vault.delete(file); } catch {}
    }
  }

  summary.ok = Object.values(summary.results).every(r => r && r.ok);
  return JSON.stringify(summary, null, 2);
})()
