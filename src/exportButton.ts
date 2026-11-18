import { Notice, setIcon } from "obsidian";
import { svgElementToPng } from "./svgToPng";
import type MermaidExporterPlugin from "./main";

const POLL_INTERVAL = 200;
const MAX_POLLS = 25; // 5 seconds max
const MARKER_ATTR = "data-mermaid-export";

export function attachExportButton(container: HTMLElement, plugin: MermaidExporterPlugin): void {
	if (container.hasAttribute(MARKER_ATTR)) return;
	container.setAttribute(MARKER_ATTR, "true");

	const svg = container.querySelector<SVGSVGElement>("svg");
	if (svg) {
		createButtons(container, svg, plugin);
	} else {
		pollForSvg(container, plugin);
	}
}

function pollForSvg(container: HTMLElement, plugin: MermaidExporterPlugin): void {
	let polls = 0;
	const timer = window.setInterval(() => {
		polls++;
		const svg = container.querySelector<SVGSVGElement>("svg");
		if (svg) {
			window.clearInterval(timer);
			createButtons(container, svg, plugin);
		} else if (polls >= MAX_POLLS) {
			window.clearInterval(timer);
			container.removeAttribute(MARKER_ATTR);
		}
	}, POLL_INTERVAL);
	plugin.registerInterval(timer);
}

function getButtonParent(container: HTMLElement): HTMLElement {
	// Prefer a wrapper *around* the diagram (Live Preview: `.cm-preview-code-block`
	// / `.cm-embed-block`; Reading mode: `.el-pre`) over the diagram's own
	// `.mermaid` element. Hosting the button bar as a sibling rather than a
	// descendant matters: some themes/plugins style `.mermaid svg` broadly
	// (e.g. to make embedded diagrams responsive) and would otherwise resize
	// our icons too.
	const codeBlock =
		container.closest<HTMLElement>(".cm-preview-code-block") ??
		container.closest<HTMLElement>(".cm-embed-block") ??
		container.closest<HTMLElement>(".el-pre");
	if (codeBlock) return codeBlock;
	return container;
}

/**
 * Build the button group (export PNG / copy image). Styling is fully
 * self-contained in styles.css rather than reusing Obsidian's internal
 * `.edit-block-button` class: that class's cascade isn't ours to
 * control and has proven unreliable for positioning/visibility across
 * Obsidian versions.
 */
function createButtons(container: HTMLElement, svg: SVGSVGElement, plugin: MermaidExporterPlugin): void {
	const parent = getButtonParent(container);

	if (parent.querySelector(".mermaid-export-btns")) return;

	if (activeWindow.getComputedStyle(parent).position === "static") {
		parent.classList.add("mermaid-export-host-static");
	}
	parent.classList.add("mermaid-export-host");

	const bar = parent.createDiv({ cls: "mermaid-export-btns" });

	const exportBtn = bar.createDiv({ cls: "mermaid-export-btn" });
	exportBtn.setAttribute("aria-label", "Export as PNG");
	setIcon(exportBtn, "download");

	const copyBtn = bar.createDiv({ cls: "mermaid-export-btn" });
	copyBtn.setAttribute("aria-label", "Copy image to clipboard");
	setIcon(copyBtn, "copy");

	plugin.registerDomEvent(exportBtn, "click", (e) => {
		e.stopPropagation();
		e.preventDefault();
		void exportPng(svg, plugin);
	});

	plugin.registerDomEvent(copyBtn, "click", (e) => {
		e.stopPropagation();
		e.preventDefault();
		void copyPng(svg, plugin);
	});
}

async function exportPng(svg: SVGSVGElement, plugin: MermaidExporterPlugin): Promise<void> {
	try {
		const blob = await svgElementToPng(svg, plugin.settings.scale, plugin.settings.theme);
		await savePng(blob);
	} catch (err) {
		new Notice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function copyPng(svg: SVGSVGElement, plugin: MermaidExporterPlugin): Promise<void> {
	try {
		const blob = await svgElementToPng(svg, plugin.settings.scale, plugin.settings.theme);
		const ok = await copyPngToClipboard(blob);
		if (ok) {
			new Notice("Image copied to clipboard");
		} else {
			new Notice("Copy failed: clipboard image write is not supported here");
		}
	} catch (err) {
		new Notice(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

interface ElectronNativeImage {
	createFromBuffer(buffer: Uint8Array): unknown;
}

/** Node's `Buffer`, reached off the global so the plugin needs no @types/node. */
interface NodeBufferGlobal {
	from(data: ArrayBuffer): Uint8Array;
}

/**
 * Electron's `nativeImage.createFromBuffer` throws unless it is handed a real
 * Node Buffer, so this keeps the runtime value a Buffer while the type stays a
 * plain `Uint8Array` — no dependency on Node's type definitions.
 */
function toNodeBuffer(data: ArrayBuffer): Uint8Array | undefined {
	return (window as { Buffer?: NodeBufferGlobal }).Buffer?.from(data);
}

interface ElectronClipboard {
	writeImage(image: unknown): void;
}

interface ElectronModule {
	clipboard?: ElectronClipboard;
	nativeImage?: ElectronNativeImage;
}

interface ElectronWindow {
	electron?: ElectronModule;
}

function getElectron(): ElectronModule | undefined {
	return (activeWindow as unknown as ElectronWindow).electron;
}

/**
 * Copy a PNG blob to the system clipboard.
 * Primary path: Electron renderer clipboard (reliable inside Obsidian
 * desktop). Fallback: async Web Clipboard API.
 */
async function copyPngToClipboard(blob: Blob): Promise<boolean> {
	const electron = getElectron();
	if (electron?.clipboard && electron?.nativeImage) {
		try {
			const buffer = toNodeBuffer(await blob.arrayBuffer());
			if (buffer) {
				electron.clipboard.writeImage(
					electron.nativeImage.createFromBuffer(buffer),
				);
				return true;
			}
		} catch (err) {
			console.error("mermaid-exporter: electron clipboard failed", err);
		}
	}

	if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
		await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
		return true;
	}
	return false;
}

async function savePng(blob: Blob): Promise<void> {
	// Obsidian exposes no "save as" dialog to plugins, and Electron's `remote`
	// module has been gone since Electron 14 — so a browser download is the
	// supported path, and it is what this plugin has always ended up doing.
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a");
	anchor.href = url;
	anchor.download = `mermaid-diagram-${Date.now()}.png`;
	anchor.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
	new Notice("Saved via browser download");
}
