import { Notice } from "obsidian";
import { svgElementToPng } from "./svgToPng";
import type MermaidExporterPlugin from "./main";

const POLL_INTERVAL = 200;
const MAX_POLLS = 25; // 5 seconds max
const MARKER_ATTR = "data-mermaid-export";

const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

export function attachExportButton(container: HTMLElement, plugin: MermaidExporterPlugin): void {
	if (container.hasAttribute(MARKER_ATTR)) return;
	container.setAttribute(MARKER_ATTR, "true");

	const svg = container.querySelector("svg") as SVGSVGElement | null;
	if (svg) {
		createButton(container, svg, plugin);
	} else {
		pollForSvg(container, plugin);
	}
}

function pollForSvg(container: HTMLElement, plugin: MermaidExporterPlugin): void {
	let polls = 0;
	const timer = setInterval(() => {
		polls++;
		const svg = container.querySelector("svg") as SVGSVGElement | null;
		if (svg) {
			clearInterval(timer);
			createButton(container, svg, plugin);
		} else if (polls >= MAX_POLLS) {
			clearInterval(timer);
			container.removeAttribute(MARKER_ATTR);
		}
	}, POLL_INTERVAL);
}

function getButtonParent(container: HTMLElement): HTMLElement {
	const codeBlock = container.closest(".cm-preview-code-block");
	if (codeBlock instanceof HTMLElement) return codeBlock;
	return container;
}

function createButton(container: HTMLElement, svg: SVGSVGElement, plugin: MermaidExporterPlugin): void {
	const parent = getButtonParent(container);

	if (parent.querySelector(".mermaid-export-btn")) return;

	const btn = document.createElement("div");
	btn.className = "edit-block-button mermaid-export-btn";
	btn.setAttribute("aria-label", "Export as PNG");
	btn.innerHTML = DOWNLOAD_ICON;

	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		e.preventDefault();
		exportPng(svg, plugin);
	});

	parent.appendChild(btn);
}

async function exportPng(svg: SVGSVGElement, plugin: MermaidExporterPlugin): Promise<void> {
	try {
		const blob = await svgElementToPng(svg, plugin.settings.scale);
		await saveWithDialog(blob);
	} catch (err) {
		console.error("Mermaid Exporter: export failed", err);
		new Notice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function saveWithDialog(blob: Blob): Promise<void> {
	const electron = (window as any).electron;
	if (!electron?.remote?.dialog) {
		new Notice("Export requires Obsidian desktop app.");
		return;
	}

	const result = await electron.remote.dialog.showSaveDialog({
		defaultPath: `mermaid-diagram.png`,
		filters: [{ name: "PNG Images", extensions: ["png"] }],
		properties: ["showOverwriteConfirmation"],
	});

	if (result.canceled || !result.filePath) return;

	const fs = require("fs") as typeof import("fs");
	const buffer = Buffer.from(await blob.arrayBuffer());
	fs.writeFileSync(result.filePath, buffer);
	new Notice(`Exported to ${result.filePath}`);
}
