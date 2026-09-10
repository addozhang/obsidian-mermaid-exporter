import { Notice, setIcon } from "obsidian";
import { svgElementToPng } from "./svgToPng";
import type MermaidExporterPlugin from "./main";

import * as fs from "fs";

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
	const timer = activeWindow.setInterval(() => {
		polls++;
		const svg = container.querySelector<SVGSVGElement>("svg");
		if (svg) {
			activeWindow.clearInterval(timer);
			createButtons(container, svg, plugin);
		} else if (polls >= MAX_POLLS) {
			activeWindow.clearInterval(timer);
			container.removeAttribute(MARKER_ATTR);
		}
	}, POLL_INTERVAL);
}

function getButtonParent(container: HTMLElement): HTMLElement {
	const codeBlock =
		container.closest<HTMLElement>(".cm-preview-code-block") ??
		container.closest<HTMLElement>(".cm-embed-block");
	if (codeBlock) return codeBlock;
	return container;
}

/**
 * Build the button group (Export PNG / Copy image).
 *
 * Buttons use self-contained classes (`mermaid-export-btns` /
 * `mermaid-export-btn`) with full styling in styles.css instead of
 * piggybacking on Obsidian's internal `.edit-block-button` styling,
 * which no longer reliably shows the button on recent Obsidian builds
 * (e.g. 1.12.x).
 */
function createButtons(container: HTMLElement, svg: SVGSVGElement, plugin: MermaidExporterPlugin): void {
	const parent = getButtonParent(container);

	if (parent.querySelector(".mermaid-export-btns")) return;

	parent.classList.add("mermaid-export-host");
	const bar = parent.createDiv({ cls: "mermaid-export-btns" });

	const exportBtn = bar.createDiv({
		cls: "mermaid-export-btn",
		attr: { "aria-label": "Export as PNG", "aria-label-position": "bottom" },
	});
	setIcon(exportBtn, "download");

	const copyBtn = bar.createDiv({
		cls: "mermaid-export-btn",
		attr: { "aria-label": "Copy image to clipboard", "aria-label-position": "bottom" },
	});
	setIcon(copyBtn, "copy");

	exportBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		e.preventDefault();
		void exportPng(svg, plugin);
	});

	copyBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		e.preventDefault();
		void copyPng(svg, plugin);
	});
}

async function exportPng(svg: SVGSVGElement, plugin: MermaidExporterPlugin): Promise<void> {
	try {
		const blob = await svgElementToPng(svg, plugin.settings.scale);
		await savePng(blob);
	} catch (err) {
		new Notice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function copyPng(svg: SVGSVGElement, plugin: MermaidExporterPlugin): Promise<void> {
	try {
		const blob = await svgElementToPng(svg, plugin.settings.scale);
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

interface ElectronRemoteDialog {
	showSaveDialog(options: {
		defaultPath: string;
		filters: { name: string; extensions: string[] }[];
		properties: string[];
	}): Promise<{ canceled: boolean; filePath?: string }>;
}

interface ElectronRemote {
	dialog: ElectronRemoteDialog;
}

interface ElectronNativeImage {
	createFromBuffer(buffer: Buffer): unknown;
}

interface ElectronClipboard {
	writeImage(image: unknown): void;
}

interface ElectronModule {
	remote?: ElectronRemote;
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
			const buffer = Buffer.from(await blob.arrayBuffer());
			electron.clipboard.writeImage(electron.nativeImage.createFromBuffer(buffer));
			return true;
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
	const electron = getElectron();
	if (electron?.remote?.dialog) {
		const result = await electron.remote.dialog.showSaveDialog({
			defaultPath: `mermaid-diagram-${Date.now()}.png`,
			filters: [{ name: "PNG Images", extensions: ["png"] }],
			properties: ["showOverwriteConfirmation"],
		});

		if (result.canceled || !result.filePath) return;

		const buffer = Buffer.from(await blob.arrayBuffer());
		await fs.promises.writeFile(result.filePath, buffer);
		new Notice(`Exported to ${result.filePath}`);
		return;
	}

	// Fallback when the Electron remote dialog is unavailable (e.g. newer
	// Obsidian builds): trigger a regular browser download of the blob.
	const url = URL.createObjectURL(blob);
	const anchor = activeDocument.createElement("a");
	anchor.href = url;
	anchor.download = `mermaid-diagram-${Date.now()}.png`;
	anchor.click();
	activeWindow.setTimeout(() => URL.revokeObjectURL(url), 10_000);
	new Notice("Saved via browser download");
}
