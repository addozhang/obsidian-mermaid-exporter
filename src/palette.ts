/**
 * Export themes.
 *
 * Obsidian 1.15 renders diagrams with Pele, which drives every colour through
 * CSS variables. The geometry of a diagram does not depend on those variables,
 * so exporting a diagram in another theme is a matter of re-declaring the
 * palette on a throwaway copy — no re-render, no re-parse of the source.
 *
 * Light uses Pele's own documented defaults, so an exported light diagram looks
 * exactly like Pele renders it without a theme. Dark is derived from the same
 * palette by inverting the surfaces while keeping the hues and contrast
 * relationships intact.
 */

export const THEME_MODES = ["follow", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export type Palette = Readonly<Record<string, string>>;

/** Pele's documented defaults — see https://pele.run/theming */
export const LIGHT_PALETTE: Palette = {
	"--pele-bg": "#ffffff",
	"--pele-fg": "#1f1f1f",
	"--pele-fg-on-light": "#1f1f1f",
	"--pele-fg-on-dark": "#ffffff",
	"--pele-muted": "#6e6e6e",
	"--pele-line": "#1f1f1f",
	"--pele-surface": "#f3f3f3",
	"--pele-surface-alt": "#e6e6e6",
	"--pele-border": "#8a8a8a",
	"--pele-accent": "#5b7bd5",
	"--pele-critical": "#e45756",
};

export const DARK_PALETTE: Palette = {
	"--pele-bg": "#1e1e1e",
	"--pele-fg": "#e6e6e6",
	// Text drawn on fills the source chose itself stays readable in both themes.
	"--pele-fg-on-light": "#1f1f1f",
	"--pele-fg-on-dark": "#f5f5f5",
	"--pele-muted": "#9a9a9a",
	"--pele-line": "#c8c8c8",
	"--pele-surface": "#2b2b2b",
	"--pele-surface-alt": "#363636",
	"--pele-border": "#6f6f6f",
	"--pele-accent": "#7aa2f7",
	"--pele-critical": "#e45756",
};

export function paletteFor(theme: ThemeMode): Palette | null {
	if (theme === "light") return LIGHT_PALETTE;
	if (theme === "dark") return DARK_PALETTE;
	return null;
}

/** Pele stamps its root `<svg>` with the `pele` class. */
export function isPeleSvg(svgEl: SVGSVGElement): boolean {
	return svgEl.classList.contains("pele");
}

/**
 * The variables to override while reading computed styles, or `undefined` when
 * the export should simply follow what Obsidian is rendering.
 *
 * Any custom property the diagram declared itself — a chart that sets its own
 * series colours, say — is left out, so it survives every theme.
 */
export function paletteOverrides(
	svgEl: SVGSVGElement,
	theme: ThemeMode,
): Map<string, string> | undefined {
	const palette = paletteFor(theme);
	if (!palette || !isPeleSvg(svgEl)) return undefined;

	const declared = new Set(
		(svgEl.getAttribute("style") ?? "")
			.split(";")
			.map((declaration) => declaration.split(":")[0]?.trim())
			.filter((prop): prop is string => Boolean(prop?.startsWith("--"))),
	);

	const overrides = new Map<string, string>();
	for (const [token, value] of Object.entries(palette)) {
		if (!declared.has(token)) overrides.set(token, value);
	}
	return overrides;
}
