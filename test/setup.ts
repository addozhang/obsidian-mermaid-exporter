// Polyfill Obsidian-injected globals/helpers used by src/svgToPng.ts so that the
// pure helpers can run under jsdom in isolation.

declare global {
	// eslint-disable-next-line no-var
	var activeWindow: Window & typeof globalThis;
	// eslint-disable-next-line no-var
	var activeDocument: Document;
	// eslint-disable-next-line no-var
	var createEl: <K extends keyof HTMLElementTagNameMap>(
		tag: K,
	) => HTMLElementTagNameMap[K];

	interface Node {
		instanceOf<T>(type: new (...args: unknown[]) => T): this is Node & T;
	}
}

// Obsidian's createEl() helper — a thin document.createElement with options.
// src/ uses it instead of document.createElement so the review's
// prefer-create-el rule is satisfied.
if (typeof (globalThis as { createEl?: unknown }).createEl === "undefined") {
	(globalThis as unknown as { createEl: unknown }).createEl = (tag: string) =>
		document.createElement(tag);
}

// Obsidian adds Node.prototype.instanceOf — emulate it with a normal instanceof check.
if (!(Node.prototype as unknown as { instanceOf?: unknown }).instanceOf) {
	Object.defineProperty(Node.prototype, "instanceOf", {
		value: function (type: unknown) {
			return this instanceof (type as new (...args: unknown[]) => unknown);
		},
		writable: true,
		configurable: true,
	});
}

// activeWindow / activeDocument are Obsidian-provided per popout; in jsdom we just
// alias the single global window/document.
if (typeof globalThis.activeWindow === "undefined") {
	(globalThis as unknown as { activeWindow: Window }).activeWindow =
		globalThis.window as Window & typeof globalThis;
}
if (typeof globalThis.activeDocument === "undefined") {
	(globalThis as unknown as { activeDocument: Document }).activeDocument = globalThis.document;
}

export {};
