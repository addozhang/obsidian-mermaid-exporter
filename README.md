# Obsidian Mermaid Exporter

Export rendered mermaid diagrams as PNG images directly from Obsidian.

## Features

- **WYSIWYG Export** — Exports the diagram exactly as Obsidian renders it, including your current theme
- **Native Save Dialog** — Uses the system file picker to save PNG files anywhere on disk
- **Configurable Resolution** — Scale factor from 1x to 4x (default 2x) for crisp high-DPI images
- **Seamless UI** — Export button appears next to the native "Edit this block" button on hover
- **Works in Both Modes** — Live Preview and Reading mode

## Installation

### From Community Plugins (coming soon)

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

## Requirements

- Obsidian ≥ 0.15.0
- Desktop only (Windows / macOS / Linux)

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

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'feat: add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE) — Addo Zhang
