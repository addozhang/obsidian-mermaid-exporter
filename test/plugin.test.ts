import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

const svgElementToPngMock = vi.fn();

vi.mock("../src/svgToPng", () => ({
	svgElementToPng: (...args: unknown[]) => svgElementToPngMock(...args),
}));

import MermaidExporterPlugin, { buildLivePreviewExtension } from "../src/main";
import { attachExportButton, cleanupExportButtons } from "../src/exportButton";

// Polyfill Obsidian's HTMLElement.prototype.createDiv / createEl for jsdom.
function installObsidianDomHelpers(): () => void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	const origCreateDiv = proto.createDiv;
	const origCreateEl = proto.createEl;

	proto.createEl = function (
		this: HTMLElement,
		tag: string,
		opts?: { cls?: string; attr?: Record<string, string> },
	) {
		const el = this.ownerDocument.createElement(tag);
		if (opts?.cls) el.className = opts.cls;
		if (opts?.attr) {
			for (const [k, v] of Object.entries(opts.attr)) {
				el.setAttribute(k, v);
			}
		}
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (
		this: HTMLElement,
		opts?: { cls?: string; attr?: Record<string, string> },
	) {
		return (
			this as unknown as {
				createEl: (tag: string, o?: { cls?: string; attr?: Record<string, string> }) => HTMLElement;
			}
		).createEl("div", opts);
	};

	return () => {
		if (origCreateDiv === undefined) delete proto.createDiv;
		else proto.createDiv = origCreateDiv;
		if (origCreateEl === undefined) delete proto.createEl;
		else proto.createEl = origCreateEl;
	};
}

function makePlugin(): MermaidExporterPlugin {
	const app = {
		workspace: {
			iterateAllLeaves: (cb: (leaf: unknown) => void) => {
				cb({ view: { containerEl: document.body } });
			},
		},
	};
	// @ts-expect-error minimal test stub for Obsidian App/Manifest
	return new MermaidExporterPlugin(app, { id: "mermaid-exporter", version: "1.4.4" });
}

describe("MermaidExporterPlugin lifecycle & DOM helpers", () => {
	let restoreDom: () => void;

	beforeEach(() => {
		document.body.innerHTML = "";
		restoreDom = installObsidianDomHelpers();
		svgElementToPngMock.mockReset();
	});

	afterEach(() => {
		restoreDom();
		vi.restoreAllMocks();
	});

	it("does not attach MutationObservers to ordinary non-code Reading mode blocks", async () => {
		const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");
		const plugin = makePlugin();
		await plugin.onload();

		const [postProcessor] = (
			plugin as unknown as {
				_getPostProcessors: () => Array<(el: HTMLElement, ctx: unknown) => void>;
			}
		)._getPostProcessors();

		const paragraph = document.createElement("div");
		paragraph.className = "el-p";
		paragraph.innerHTML = "<p>Just plain text</p>";
		document.body.appendChild(paragraph);

		postProcessor(paragraph, {});
		expect(observeSpy).not.toHaveBeenCalled();

		const codeHost = document.createElement("div");
		codeHost.className = "el-pre";
		codeHost.innerHTML = '<pre><code class="language-mermaid">flowchart LR</code></pre>';
		document.body.appendChild(codeHost);

		postProcessor(codeHost, {});
		expect(observeSpy).toHaveBeenCalledTimes(1);

		plugin.onunload();
	});

	it("injects keyboard-focusable <button> elements and resolves the latest <svg> on click", async () => {
		const plugin = makePlugin();
		await plugin.onload();

		const wrapper = document.createElement("div");
		wrapper.className = "el-pre";
		const mermaid = document.createElement("div");
		mermaid.className = "mermaid";
		const firstSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		firstSvg.id = "first";
		mermaid.appendChild(firstSvg);
		wrapper.appendChild(mermaid);
		document.body.appendChild(wrapper);

		attachExportButton(mermaid, plugin);

		const buttons = wrapper.querySelectorAll("button.mermaid-export-btn");
		expect(buttons.length).toBe(2);
		expect(buttons[0].getAttribute("type")).toBe("button");
		expect(buttons[1].getAttribute("type")).toBe("button");

		// Simulate Obsidian re-rendering the SVG in-place.
		firstSvg.remove();
		const secondSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		secondSvg.id = "second";
		mermaid.appendChild(secondSvg);

		svgElementToPngMock.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
		const origCreateObjectURL = URL.createObjectURL;
		const origRevokeObjectURL = URL.revokeObjectURL;
		URL.createObjectURL = vi.fn(() => "blob:mock");
		URL.revokeObjectURL = vi.fn();
		const clickSpy = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});

		try {
			(buttons[0] as HTMLButtonElement).click();
			await new Promise((r) => setTimeout(r, 0));

			expect(svgElementToPngMock).toHaveBeenCalledTimes(1);
			expect(svgElementToPngMock.mock.calls[0][0]).toBe(secondSvg);
			expect(clickSpy).toHaveBeenCalledTimes(1);
		} finally {
			URL.createObjectURL = origCreateObjectURL;
			URL.revokeObjectURL = origRevokeObjectURL;
			plugin.onunload();
		}
	});

	it("cleans up injected buttons, host classes, and marker attributes on onunload()", async () => {
		const plugin = makePlugin();
		await plugin.onload();

		const wrapper = document.createElement("div");
		wrapper.className = "el-pre";
		const mermaid = document.createElement("div");
		mermaid.className = "mermaid";
		mermaid.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
		wrapper.appendChild(mermaid);
		document.body.appendChild(wrapper);

		attachExportButton(mermaid, plugin);
		expect(wrapper.querySelector(".mermaid-export-btns")).not.toBeNull();
		expect(wrapper.classList.contains("mermaid-export-host")).toBe(true);
		expect(mermaid.hasAttribute("data-mermaid-export")).toBe(true);

		plugin.onunload();

		expect(wrapper.querySelector(".mermaid-export-btns")).toBeNull();
		expect(wrapper.classList.contains("mermaid-export-host")).toBe(false);
		expect(wrapper.classList.contains("mermaid-export-host-static")).toBe(false);
		expect(mermaid.hasAttribute("data-mermaid-export")).toBe(false);

		// Re-attaching after unload works cleanly.
		attachExportButton(mermaid, plugin);
		expect(wrapper.querySelector(".mermaid-export-btns")).not.toBeNull();
		cleanupExportButtons(document);
	});

	it("cancels pending requestAnimationFrame when Live Preview ViewPlugin is destroyed", () => {
		const plugin = makePlugin();
		const processSpy = vi.spyOn(plugin, "processMermaidBlocks");

		let queuedCallback: FrameRequestCallback | null = null;
		const rafSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((cb: FrameRequestCallback) => {
				queuedCallback = cb;
				return 42;
			});
		const cancelSpy = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => {
				queuedCallback = null;
			});

		const dom = document.createElement("div");
		dom.innerHTML = '<div class="mermaid"><svg></svg></div>';
		document.body.appendChild(dom);

		const ext = buildLivePreviewExtension(plugin);
		const instance = ext.create({ dom } as unknown as EditorView);

		expect(rafSpy).toHaveBeenCalledTimes(1);
		instance.destroy?.();

		expect(cancelSpy).toHaveBeenCalledWith(42);
		expect(queuedCallback).toBeNull();
		expect(processSpy).not.toHaveBeenCalled();
	});
});
