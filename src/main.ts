import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import {
	MermaidExporterSettings,
	DEFAULT_SETTINGS,
	MermaidExporterSettingTab,
} from "./settings";
import { attachExportButton } from "./exportButton";

const MERMAID_SELECTOR = ".mermaid, .block-language-mermaid";

export default class MermaidExporterPlugin extends Plugin {
	settings: MermaidExporterSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MermaidExporterSettingTab(this.app, this));

		// Reading mode: Obsidian's supported, scoped extension point.
		// Obsidian's built-in mermaid renderer replaces a placeholder
		// `<pre>` with a `<div class="mermaid">` asynchronously, often
		// *after* this post-processor first runs. We synchronously try
		// the current subtree, and if no mermaid block is present yet
		// we attach a short-lived MutationObserver scoped to `el` only
		// (never `document.body`) that waits for the replacement and
		// disconnects itself once it fires or a 5s budget elapses.
		this.registerMarkdownPostProcessor(
			(el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
				if (this.processMermaidBlocks(el)) return;
				this.observeForLateMermaid(el);
			},
			100,
		);

		// Live Preview: a CodeMirror ViewPlugin attached per editor instance.
		// Each popout window has its own editor view, so this automatically
		// covers popout windows without a global document observer.
		this.registerEditorExtension(buildLivePreviewExtension(this));
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
	 * Scoped, short-lived MutationObserver as a fallback for the
	 * reading-mode case where Obsidian renders the mermaid block
	 * asynchronously *after* the post-processor first runs. Scope is
	 * `el` (a single rendered block container), never `document.body`,
	 * and the observer auto-disconnects on the first hit or after a
	 * 5-second budget — so it does not contribute to global mutation
	 * traffic the way the old plugin-wide observer did.
	 */
	private observeForLateMermaid(el: HTMLElement): void {
		const win = el.ownerDocument?.defaultView ?? activeWindow;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			observer.disconnect();
			win.clearTimeout(timeoutId);
		};
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
 */
function buildLivePreviewExtension(plugin: MermaidExporterPlugin) {
	class MermaidExportViewPlugin implements PluginValue {
		private scheduled = false;

		constructor(private view: EditorView) {
			this.schedule();
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.viewportChanged) {
				this.schedule();
			}
		}

		destroy(): void {
			// no-op: buttons live in the editor DOM and are torn down
			// with the view itself; per-button listeners are owned by
			// the plugin via registerDomEvent.
		}

		private schedule(): void {
			if (this.scheduled) return;
			this.scheduled = true;
			// Defer until after CodeMirror has finished painting the
			// rendered mermaid block into `.cm-preview-code-block`.
			activeWindow.requestAnimationFrame(() => {
				this.scheduled = false;
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
