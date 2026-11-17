# Obsidian Mermaid Exporter

Export rendered mermaid diagrams as PNG images directly from Obsidian.

## Features

- **WYSIWYG Export** — Exports the diagram exactly as Obsidian renders it, including your current theme
- **Theme-aware colors** — Works with both renderers: Mermaid (Obsidian ≤ 1.14) and Pele (Obsidian ≥ 1.15)
- **Native Save Dialog** — Uses the system file picker to save PNG files anywhere on disk
- **Configurable Resolution** — Scale factor from 1x to 4x (default 2x) for crisp high-DPI images
- **Seamless UI** — Export button appears next to the native "Edit this block" button on hover
- **Works in Both Modes** — Live Preview and Reading mode

## Installation

### From Community Plugins

1. Open **Settings → Community Plugins → Browse**
2. Search for **Mermaid Exporter**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/addozhang/obsidian-mermaid-exporter/releases/latest)
2. Create folder: `<vault>/.obsidian/plugins/mermaid-exporter/`
3. Copy the three files into that folder
4. Reload Obsidian and enable the plugin in **Settings → Community Plugins**

## Usage

1. Create a mermaid code block in any note
2. Hover over the rendered diagram
3. Click the download button (appears top-right, next to the edit button)
4. Choose a save location in the system dialog
5. Done — PNG saved to disk

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Image scale | 2 | Resolution multiplier for exported PNG (1–4x) |
| Export theme | Match Obsidian | Colours baked into the PNG: follow the note, or always use Light / Dark |

### Export theme

`Match Obsidian` keeps whatever colours the diagram is rendered with. `Light` and `Dark` always export a fixed palette, which is what you want when the image lands in a document with a background you don't control — a light blog post, a dark slide deck, a PDF.

Pele drives every colour through CSS variables, so switching theme is a recolour, not a re-render: label positions, shapes and line breaks stay exactly as measured. Any palette the diagram sets itself (e.g. `%%{init: {"themeVariables": {"pie1": "#..."}}}%%`) is left alone in every theme.

This applies to diagrams drawn by Pele (Obsidian 1.15 and later). Diagrams rendered by the older Mermaid engine bake their colours into the SVG, so they always export as rendered.

## Requirements

- Obsidian ≥ 1.5.0
- Desktop only (Windows / macOS / Linux)

## How it works

Obsidian 1.15 replaced its bundled Mermaid renderer with [Pele](https://pele.run/), which paints diagrams with CSS variables (`fill="var(--_fg)"`, `stroke="var(--_l)"`, …) and keeps those variables in the root `<svg>`'s inline `style`. Before an SVG can be rasterized through a canvas it has to be serialized into a data URL, where the document stylesheet no longer applies. The plugin therefore resolves every `var()` reference against the live, themed element before serializing — so the PNG keeps the colors, corner radii and fonts you see in the note, and the canvas is filled with the diagram's own background instead of a hard-coded white.

Mermaid's pre-1.15 output is still handled: HTML labels inside `<foreignObject>` are converted to `<text>`, `:root` rules are stripped, and percentage-based sizing is replaced with the viewBox dimensions.

## Development

```bash
git clone https://github.com/addozhang/obsidian-mermaid-exporter.git
cd obsidian-mermaid-exporter
npm install
npm run dev    # watch mode
npm run build  # production build
```

To test locally, symlink or copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/mermaid-exporter/` directory.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, bug reports, and pull request guidelines.

## License

[MIT](LICENSE) — Addo Zhang
