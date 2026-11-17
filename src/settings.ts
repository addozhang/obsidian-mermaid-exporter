import { App, PluginSettingTab, Setting } from "obsidian";
import type MermaidExporterPlugin from "./main";
import { THEME_MODES, type ThemeMode } from "./palette";

export interface MermaidExporterSettings {
	/** PNG resolution multiplier (1–4). Default 2. */
	scale: number;
	/**
	 * Colours baked into the exported PNG. `follow` keeps what Obsidian is
	 * rendering right now. Only applies to diagrams drawn by Pele
	 * (Obsidian ≥ 1.15), which is what makes recolouring possible at all.
	 */
	theme: ThemeMode;
}

export const DEFAULT_SETTINGS: MermaidExporterSettings = {
	scale: 2,
	theme: "follow",
};

const THEME_LABELS: Record<ThemeMode, string> = {
	follow: "Match Obsidian",
	light: "Light",
	dark: "Dark",
};

export class MermaidExporterSettingTab extends PluginSettingTab {
	plugin: MermaidExporterPlugin;

	constructor(app: App, plugin: MermaidExporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Image scale")
			.setDesc(
				"Resolution multiplier for exported PNG images. " +
				"Higher values produce sharper images but larger files. (1–4, default 2)"
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(this.plugin.settings.scale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.scale = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Export theme")
			.setDesc(
				"Colours used in the exported image. \"Match Obsidian\" follows the " +
				"theme you are reading in; Light and Dark always export that palette, " +
				"which is handy when a diagram goes into a document with a fixed " +
				"background. Applies to diagrams rendered by Obsidian 1.15 and later."
			)
			.addDropdown((dropdown) => {
				for (const mode of THEME_MODES) {
					dropdown.addOption(mode, THEME_LABELS[mode]);
				}
				dropdown
					.setValue(this.plugin.settings.theme)
					.onChange(async (value) => {
						this.plugin.settings.theme = value as ThemeMode;
						await this.plugin.saveSettings();
					});
			});
	}
}
