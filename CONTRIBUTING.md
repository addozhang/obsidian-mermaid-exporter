# Contributing to Mermaid Exporter

Thanks for your interest in contributing! This document explains how to set up a development environment, propose changes, and submit pull requests.

## Development setup

```bash
git clone https://github.com/addozhang/obsidian-mermaid-exporter.git
cd obsidian-mermaid-exporter
npm install
npm run dev    # watch mode
npm run build  # production build
```

To test locally, symlink or copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/mermaid-exporter/` directory, then reload Obsidian and enable the plugin.

## Reporting bugs

Open an issue at <https://github.com/addozhang/obsidian-mermaid-exporter/issues> with:

- Obsidian version, OS, and plugin version
- A minimal reproduction (a mermaid block or note that triggers the bug)
- Expected vs. actual behavior
- Console errors, if any (`Ctrl+Shift+I` → Console)

## Proposing changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes, keeping commits focused and atomic
4. Run `npm run build` and `npx tsc --noEmit` — both must pass
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add transparent background option`)
6. Push the branch (`git push origin feature/your-feature`)
7. Open a Pull Request describing the motivation and the change

## Code style

- TypeScript with `strictNullChecks` enabled
- Follow Obsidian's [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) — in particular: prefer `activeWindow` / `activeDocument`, use `.instanceOf(...)` for cross-window safe type checks, and prefer `createEl` / `createDiv` over `document.createElement`
- Keep `main.js` reproducible from source (the release pipeline verifies this)

## Releasing (maintainers)

1. Bump `version` in `manifest.json` and `package.json`
2. Commit and tag (`git tag v1.0.4 && git push --tags`)
3. The release workflow publishes `main.js`, `manifest.json`, and `styles.css` with build provenance attestation

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
