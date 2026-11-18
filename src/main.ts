import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import {
	MermaidExporterSettings,
	DEFAULT_SETTINGS,
	MermaidExporterSettingTab,
} from "./settings";
import { attachExportButton, cleanupExportButtons } from "./exportButton";

const MERMAID_SELECTOR = ".mermaid, .block-language-mermaid";

export default class MermaidExporterPlugin extends Plugin {
	settings: MermaidExporterSettings = DEFAULT_SETTINGS;
	private pendingObservers = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MermaidExporterSettingTab(this.app, this));

		// Reading mode: Obsidian's supported, scoped extension point.
		// Obsidian's built-in mermaid renderer replaces a placeholder
		// `<pre>` with a `<div class="mermaid">` asynchronously, often
		// *after* this post-processor first runs. We synchronously try
		// the current subtree, and only when the block could actually
		// host a code block do we attach a short-lived MutationObserver
		// scoped to `el` (never `document.body`) that disconnects once
		// it fires, on unload, or after a 5s budget.
		this.registerMarkdownPostProcessor(
			(el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
				if (this.processMermaidBlocks(el)) return;
				if (this.mightBecomeMermaid(el)) {
					this.observeForLateMermaid(el);
				}
			},
			100,
		);

		// Live Preview: a CodeMirror ViewPlugin attached per editor instance.
		// Each popout window has its own editor view, so this automatically
		// covers popout windows without a global document observer.
		this.registerEditorExtension(buildLivePreviewExtension(this));
	}

	onunload(): void {
		for (const finish of Array.from(this.pendingObservers)) {
			finish();
		}

		const docs = new Set<Document>();
		if (typeof activeDocument !== "undefined") docs.add(activeDocument);
		this.app?.workspace?.iterateAllLeaves?.((leaf) => {
			const doc = leaf.view?.containerEl?.ownerDocument;
			if (doc) docs.add(doc);
		});
		for (const doc of docs) {
			cleanupExportButtons(doc);
		}
	}

	/**
	 * Attach an export button to any mermaid block at or beneath `el`.
	 * Returns `true` iff at least one mermaid block was found and
	 * processed in this synchronous pass — used by the post-processor
	 * to decide whether to fall back to a scoped late-render observer.
	 */
	processMermaidBlocks(el: HTMLElement): boolean {
		const isMermaidContainer =
			el.classList?.contains("mermaid") ||
			el.classList?.contains("block-language-mermaid");

		if (isMermaidContainer) {
			attachExportButton(el, this);
			return true;
		}

		const blocks = el.querySelectorAll<HTMLElement>(MERMAID_SELECTOR);
		blocks.forEach((block) => {
			attachExportButton(block, this);
		});
		return blocks.length > 0;
	}

	/**
	 * Quick pre-filter so we don't attach a MutationObserver and 5s timer
	 * to every paragraph, heading, or list rendered in Reading mode.
	 */
	private mightBecomeMermaid(el: HTMLElement): boolean {
		return (
			el.tagName === "PRE" ||
			el.classList?.contains("el-pre") ||
			el.querySelector("pre, code.language-mermaid") !== null
		);
	}

	/**
	 * Scoped, short-lived MutationObserver as a fallback for the
	 * reading-mode case where Obsidian renders the mermaid block
	 * asynchronously *after* the post-processor first runs. Scope is
	 * `el` (a single rendered block container), never `document.body`,
	 * and the observer auto-disconnects on the first hit, on unload,
	 * or after a 5-second budget.
	 */
	private observeForLateMermaid(el: HTMLElement): void {
		const win = el.ownerDocument?.defaultView ?? activeWindow;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			observer.disconnect();
			win.clearTimeout(timeoutId);
			this.pendingObservers.delete(finish);
		};
		this.pendingObservers.add(finish);
		const observer = new MutationObserver(() => {
			if (this.processMermaidBlocks(el)) finish();
		});
		observer.observe(el, { childList: true, subtree: true });
		const timeoutId = win.setTimeout(finish, 5000);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<MermaidExporterSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/**
 * Build a CodeMirror ViewPlugin that scans the editor view's DOM
 * for mermaid code blocks rendered in Live Preview and attaches the
 * export button. Scope is the editor view's `.cm-content`, not the
 * whole document — this is what makes the plugin cheap and what
 * makes popout windows work automatically (each editor instance
 * carries its own copy of the extension).
 *
 * `docChanged`/`viewportChanged` alone aren't enough: Obsidian renders
 * a mermaid block asynchronously (swapping the raw `<pre><code>` for
 * the rendered `.mermaid` widget after mermaid.js finishes, well after
 * construction-time `schedule()` already ran and found nothing), and
 * the same swap happens *every time the cursor enters/leaves the
 * block* to toggle source/rendered view — neither of which touches
 * the document or the viewport. A MutationObserver scoped to this
 * view's own DOM (never `document.body`) catches both; it's cheap
 * because `processMermaidBlocks` is a no-op past the first mermaid
 * block it finds already marked, and rescans are coalesced into one
 * `requestAnimationFrame` per burst of mutations.
 */
export function buildLivePreviewExtension(plugin: MermaidExporterPlugin) {
	class MermaidExportViewPlugin implements PluginValue {
		private rafId: number | null = null;
		private observer: MutationObserver;

		constructor(private view: EditorView) {
			this.observer = new MutationObserver(() => this.schedule());
			this.observer.observe(view.dom, { childList: true, subtree: true });
			this.schedule();
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.viewportChanged) {
				this.schedule();
			}
		}

		destroy(): void {
			this.observer.disconnect();
			if (this.rafId !== null) {
				const win = this.view.dom.ownerDocument?.defaultView ?? window;
				win.cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
		}

		private schedule(): void {
			if (this.rafId !== null) return;
			const win = this.view.dom.ownerDocument?.defaultView ?? window;
			// Defer until after CodeMirror has finished painting the
			// rendered mermaid block into `.cm-preview-code-block`.
			this.rafId = win.requestAnimationFrame(() => {
				this.rafId = null;
				this.scan();
			});
		}

		private scan(): void {
			this.view.dom
				.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)
				.forEach((el) => plugin.processMermaidBlocks(el));
		}
	}

	return ViewPlugin.fromClass(MermaidExportViewPlugin);
}
