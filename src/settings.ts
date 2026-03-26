import { App, PluginSettingTab, Setting } from "obsidian";
import type MermaidExporterPlugin from "./main";

export interface MermaidExporterSettings {
	/** PNG resolution multiplier (1–4). Default 2. */
	scale: number;
}

export const DEFAULT_SETTINGS: MermaidExporterSettings = {
	scale: 2,
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

		new Setting(containerEl).setName("Mermaid exporter").setHeading();

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
	}
}
