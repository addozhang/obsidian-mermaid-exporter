import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
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

const SCALE_LIMITS = { min: 1, max: 4, step: 1 } as const;

const THEME_LABELS: Record<ThemeMode, string> = {
	follow: "Match Obsidian",
	light: "Light",
	dark: "Dark",
};

const SCALE_DESC =
	"Resolution multiplier for exported PNG images. " +
	"Higher values produce sharper images but larger files. (1–4, default 2)";

const THEME_DESC =
	'Colours used in the exported image. "Match Obsidian" follows the ' +
	"theme you are reading in; Light and Dark always export that palette, " +
	"which is handy when a diagram goes into a document with a fixed " +
	"background. Applies to diagrams rendered by Obsidian 1.15 and later.";

type SettingKey = keyof MermaidExporterSettings;

export class MermaidExporterSettingTab extends PluginSettingTab<MermaidExporterSettings> {
	plugin: MermaidExporterPlugin;

	constructor(app: App, plugin: MermaidExporterPlugin) {
		super(app, plugin, plugin.settings);
		this.plugin = plugin;
	}

	/**
	 * Declarative definitions for Obsidian 1.13 and later. These are what make
	 * the settings show up in the settings search.
	 */
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: "Image scale",
				desc: SCALE_DESC,
				aliases: ["resolution", "dpi", "quality", "scale"],
				control: {
					type: "slider",
					key: "scale",
					defaultValue: DEFAULT_SETTINGS.scale,
					...SCALE_LIMITS,
				},
			},
			{
				name: "Export theme",
				desc: THEME_DESC,
				aliases: ["colours", "colors", "dark mode", "light mode"],
				control: {
					type: "dropdown",
					key: "theme",
					defaultValue: DEFAULT_SETTINGS.theme,
					options: THEME_LABELS,
				},
			},
		];
	}

	/**
	 * Imperative fallback for Obsidian versions before 1.13, which have no
	 * declarative renderer. Not called on 1.13+ while the definitions above
	 * return a non-empty array.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Image scale")
			.setDesc(SCALE_DESC)
			.addSlider((slider) =>
				slider
					.setLimits(SCALE_LIMITS.min, SCALE_LIMITS.max, SCALE_LIMITS.step)
					.setValue(this.plugin.settings.scale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.scale = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Export theme")
			.setDesc(THEME_DESC)
			.addDropdown((dropdown) => {
				for (const mode of THEME_MODES) {
					dropdown.addOption(mode, THEME_LABELS[mode]);
				}
				dropdown.setValue(this.plugin.settings.theme).onChange(async (value) => {
					this.plugin.settings.theme = value as ThemeMode;
					await this.plugin.saveSettings();
				});
			});
	}
}
