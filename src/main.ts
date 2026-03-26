import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import {
	MermaidExporterSettings,
	DEFAULT_SETTINGS,
	MermaidExporterSettingTab,
} from "./settings";
import { attachExportButton } from "./exportButton";

export default class MermaidExporterPlugin extends Plugin {
	settings: MermaidExporterSettings = DEFAULT_SETTINGS;
	private observer: MutationObserver | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MermaidExporterSettingTab(this.app, this));

		this.registerMarkdownPostProcessor(
			(el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
				this.processMermaidBlocks(el);
			},
			100,
		);

		this.app.workspace.onLayoutReady(() => {
			this.startObserver();
		});
	}

	onunload(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	private startObserver(): void {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement)) continue;
					if (node.matches?.(".mermaid, .block-language-mermaid")) {
						this.processMermaidBlocks(node);
					}
					this.processMermaidBlocks(node);
				}
			}
		});

		this.observer.observe(document.body, { childList: true, subtree: true });

		document.querySelectorAll<HTMLElement>(".mermaid, .block-language-mermaid").forEach((el) => {
			this.processMermaidBlocks(el);
		});
	}

	private processMermaidBlocks(el: HTMLElement): void {
		const isMermaidContainer =
			el.classList?.contains("mermaid") || el.classList?.contains("block-language-mermaid");

		if (isMermaidContainer) {
			attachExportButton(el, this);
			return;
		}

		el.querySelectorAll<HTMLElement>(".mermaid, .block-language-mermaid").forEach((block) => {
			attachExportButton(block, this);
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
