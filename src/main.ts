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
		this.registerMarkdownPostProcessor(
			(el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
				this.processMermaidBlocks(el);
			},
			100,
		);

		// Live Preview: a CodeMirror ViewPlugin attached per editor instance.
		// Each popout window has its own editor view, so this automatically
		// covers popout windows without a global document observer.
		this.registerEditorExtension(buildLivePreviewExtension(this));
	}

	processMermaidBlocks(el: HTMLElement): void {
		const isMermaidContainer =
			el.classList?.contains("mermaid") ||
			el.classList?.contains("block-language-mermaid");

		if (isMermaidContainer) {
			attachExportButton(el, this);
			return;
		}

		el.querySelectorAll<HTMLElement>(MERMAID_SELECTOR).forEach((block) => {
			attachExportButton(block, this);
		});
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
