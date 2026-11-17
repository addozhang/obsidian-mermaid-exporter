const MAX_CANVAS_DIMENSION = 16384;
const SVG_NS = "http://www.w3.org/2000/svg";

// Declarations that only make sense inside a live note (responsive sizing).
// Dropped from the exported root so the PNG keeps the diagram's intrinsic size.
const LAYOUT_PROPS = new Set([
	"max-width",
	"min-width",
	"width",
	"max-height",
	"min-height",
	"height",
]);

export function svgElementToPng(svgEl: SVGSVGElement, scale: number): Promise<Blob> {
	const node = svgEl.cloneNode(true);
	if (!node.instanceOf(SVGSVGElement)) {
		throw new Error("Failed to clone SVG element");
	}
	sanitizeSvg(node, svgEl);
	const background = resolveBackground(svgEl);
	const svgString = new XMLSerializer().serializeToString(node);
	const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			let canvasWidth = img.naturalWidth * scale;
			let canvasHeight = img.naturalHeight * scale;
			if (canvasWidth > MAX_CANVAS_DIMENSION || canvasHeight > MAX_CANVAS_DIMENSION) {
				const downscale = Math.min(
					MAX_CANVAS_DIMENSION / canvasWidth,
					MAX_CANVAS_DIMENSION / canvasHeight,
				);
				canvasWidth = Math.floor(canvasWidth * downscale);
				canvasHeight = Math.floor(canvasHeight * downscale);
			}

			const canvas = createEl("canvas");
			canvas.width = canvasWidth;
			canvas.height = canvasHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Failed to get 2D canvas context"));
				return;
			}
			ctx.fillStyle = background;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
				"image/png",
			);
		};
		img.onerror = () => reject(new Error("Failed to load SVG as image"));
		img.src = dataUrl;
	});
}

export function sanitizeSvg(svgEl: SVGSVGElement, originalSvgEl: SVGSVGElement): void {
	// Order matters: CSS variables are resolved while the clone is still
	// structurally identical to the live tree (parallel walk), because later
	// steps (foreignObject → text) change the shape of both trees.
	resolveCssVariables(svgEl, originalSvgEl);
	replaceForeignObjects(svgEl, originalSvgEl);
	stripRootCss(svgEl);
	cleanRootStyle(svgEl, originalSvgEl);
	fixDimensions(svgEl);
}

/* ------------------------------------------------------------------ *
 * CSS custom property resolution
 * ------------------------------------------------------------------ */

/**
 * Obsidian ≥ 1.15 renders diagrams with Pele, which expresses every color
 * as a CSS variable (`fill="var(--_fg)"`, `stroke="var(--_l)"`, …) and
 * declares those variables in the root <svg>'s inline `style`. Once the
 * SVG is serialized into a data URL and loaded as an <img>, the document
 * stylesheet is gone — only the inline declarations survive. So every
 * `var()` reference has to be baked into a literal value taken from the
 * live, themed element before serialization.
 *
 * Mermaid's own output benefits too: it also leans on variables that live
 * outside the SVG.
 */
export function resolveCssVariables(
	svgEl: SVGSVGElement,
	originalSvgEl: SVGSVGElement,
): void {
	// Variables declared inline on the live root — the only declarations that
	// survive serialization. Used as a second lookup path: a reference that the
	// engine cannot compute (or does not compute yet) still resolves to the
	// default it was declared with, instead of disappearing.
	const declared = new Map(
		parseStyle(originalSvgEl.getAttribute("style") ?? "").filter(([prop]) =>
			prop.startsWith("--"),
		),
	);

	forEachPair(svgEl, originalSvgEl, (el, original) => {
		const attrs = Array.from(el.attributes).filter((attr) => attr.value.includes("var("));
		if (attrs.length === 0) return;
		const lookup = createVarLookup(original, declared);
		for (const attr of attrs) {
			el.setAttribute(attr.name, resolveVarsInString(attr.value, lookup));
		}
	});
}

function createVarLookup(
	el: Element,
	declared: Map<string, string> = new Map(),
): (name: string) => string | undefined {
	const win = el.ownerDocument?.defaultView ?? activeWindow;
	const computed = win.getComputedStyle(el);
	const cache = new Map<string, string | undefined>();

	const lookup = (name: string, depth = 0): string | undefined => {
		if (cache.has(name)) return cache.get(name);
		cache.set(name, undefined); // guards against self-referential cycles

		const fromComputed = computed.getPropertyValue(name).trim();
		// An unresolvable variable comes back empty, or still holding a `var()`
		// reference we cannot follow — treat both as missing.
		let value: string | undefined =
			fromComputed && !fromComputed.includes("var(") ? fromComputed : undefined;

		if (value === undefined && depth < 5) {
			const decl = declared.get(name);
			if (decl !== undefined) {
				const resolved = resolveVarsInString(decl, (next) => lookup(next, depth + 1), 1);
				value = resolved.trim() || undefined;
			}
		}

		cache.set(name, value);
		return value;
	};

	return (name) => lookup(name);
}

/**
 * Replaces every `var(--x)` / `var(--x, fallback)` in `input` with either
 * the value from `lookup` or the declared fallback. Supports nested
 * fallbacks such as `var(--a, var(--b, #fff))`.
 */
export function resolveVarsInString(
	input: string,
	lookup: (name: string) => string | undefined,
	depth = 0,
): string {
	if (depth > 10 || !input.includes("var(")) return input;

	let out = "";
	let index = 0;
	while (index < input.length) {
		const start = input.indexOf("var(", index);
		if (start < 0) {
			out += input.slice(index);
			break;
		}
		out += input.slice(index, start);

		const end = findClosingParen(input, start + 4);
		if (end < 0) {
			// Unbalanced input — leave the remainder untouched.
			out += input.slice(start);
			break;
		}

		const inner = input.slice(start + 4, end);
		const comma = findTopLevelComma(inner);
		const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
		const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();

		const resolved = name.startsWith("--") ? lookup(name) : undefined;
		if (resolved !== undefined) {
			out += resolveVarsInString(resolved, lookup, depth + 1);
		} else if (fallback !== undefined) {
			out += resolveVarsInString(fallback, lookup, depth + 1);
		}
		// Neither resolvable nor a fallback: drop the reference entirely so we
		// never emit an invalid value into the exported image.

		index = end + 1;
	}
	return out;
}

function findClosingParen(input: string, from: number): number {
	let level = 1;
	for (let i = from; i < input.length; i++) {
		const char = input[i];
		if (char === "(") level++;
		else if (char === ")" && --level === 0) return i;
	}
	return -1;
}

function findTopLevelComma(input: string): number {
	let level = 0;
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (char === "(") level++;
		else if (char === ")") level--;
		else if (char === "," && level === 0) return i;
	}
	return -1;
}

/** Walks two structurally identical trees in parallel (clone vs live DOM). */
function forEachPair(
	a: Element,
	b: Element,
	visit: (el: Element, original: Element) => void,
): void {
	visit(a, b);
	const aChildren = Array.from(a.children);
	const bChildren = Array.from(b.children);
	const count = Math.min(aChildren.length, bChildren.length);
	for (let i = 0; i < count; i++) {
		forEachPair(aChildren[i], bChildren[i], visit);
	}
}

/**
 * Normalizes the root `style` attribute: drops the custom property
 * declarations (now baked into every reference) and the responsive sizing
 * that only makes sense inside a note. What remains — font, colour,
 * letter-spacing — is plain CSS that survives serialization.
 */
export function cleanRootStyle(svgEl: SVGSVGElement, _originalSvgEl?: SVGSVGElement): void {
	const declarations = parseStyle(svgEl.getAttribute("style") ?? "");
	const kept = declarations.filter(
		([prop]) => !prop.startsWith("--") && !LAYOUT_PROPS.has(prop),
	);
	const style = kept.map(([prop, value]) => `${prop}:${value}`).join(";");
	if (style) svgEl.setAttribute("style", style);
	else svgEl.removeAttribute("style");
}

function parseStyle(style: string): [string, string][] {
	const out: [string, string][] = [];
	for (const part of style.split(";")) {
		const at = part.indexOf(":");
		if (at < 0) continue;
		const prop = part.slice(0, at).trim().toLowerCase();
		const value = part.slice(at + 1).trim();
		if (prop && value) out.push([prop, value]);
	}
	return out;
}

/**
 * The canvas background: the diagram's own `--pele-bg` (i.e. the theme
 * background) when available, otherwise white. Without this a dark-theme
 * diagram would export light text onto a white canvas.
 */
export function resolveBackground(svgEl: SVGSVGElement): string {
	const declared = new Map(
		parseStyle(svgEl.getAttribute("style") ?? "").filter(([prop]) =>
			prop.startsWith("--"),
		),
	);
	const lookup = createVarLookup(svgEl, declared);
	for (const name of ["--_bg", "--pele-bg"]) {
		const value = lookup(name);
		if (!value || value.includes("var(")) continue;
		// A transparent theme background would produce a PNG that looks empty
		// in most viewers — fall back to white instead.
		if (/^(transparent|none)$/i.test(value)) continue;
		if (/^rgba?\([^)]*,\s*0(\.0+)?\s*\)$/i.test(value)) continue;
		return value;
	}
	return "#ffffff";
}

/* ------------------------------------------------------------------ *
 * Mermaid (pre-1.15) fallbacks
 * ------------------------------------------------------------------ */

export function replaceForeignObjects(svgEl: SVGSVGElement, originalSvgEl: SVGSVGElement): void {
	const clonedFOs = Array.from(svgEl.querySelectorAll("foreignObject"));
	const originalFOs = Array.from(originalSvgEl.querySelectorAll("foreignObject"));

	clonedFOs.forEach((fo, idx) => {
		const x = parseFloat(fo.getAttribute("x") || "0");
		const y = parseFloat(fo.getAttribute("y") || "0");
		const width = parseFloat(fo.getAttribute("width") || "100");
		const height = parseFloat(fo.getAttribute("height") || "50");

		const lines = extractTextLines(fo);
		if (lines.length === 0) {
			fo.remove();
			return;
		}

		const originalFo = originalFOs[idx];
		const styledEl = originalFo?.querySelector<HTMLElement>("span, div, p") ?? null;
		const computed = styledEl ? activeWindow.getComputedStyle(styledEl) : null;
		const fontSize = parseFloat(computed?.fontSize || "14");
		const fontFamily = computed?.fontFamily || "sans-serif";
		const fill = computed?.color || "#333";

		const textEl = activeDocument.createElementNS(SVG_NS, "text");
		textEl.setAttribute("text-anchor", "middle");
		textEl.setAttribute("font-size", String(fontSize));
		textEl.setAttribute("font-family", fontFamily);
		textEl.setAttribute("fill", fill);

		const centerX = x + width / 2;

		if (lines.length === 1) {
			textEl.setAttribute("x", String(centerX));
			textEl.setAttribute("y", String(y + height / 2));
			textEl.setAttribute("dominant-baseline", "middle");
			textEl.textContent = lines[0];
		} else {
			const lineHeight = fontSize * 1.2;
			const totalTextHeight = lineHeight * lines.length;
			const startY = y + (height - totalTextHeight) / 2 + fontSize;
			for (let i = 0; i < lines.length; i++) {
				const tspan = activeDocument.createElementNS(SVG_NS, "tspan");
				tspan.setAttribute("x", String(centerX));
				tspan.setAttribute("y", String(startY + i * lineHeight));
				tspan.textContent = lines[i];
				textEl.appendChild(tspan);
			}
		}

		fo.parentNode?.replaceChild(textEl, fo);
	});

	svgEl.querySelectorAll("switch").forEach((sw) => {
		while (sw.firstChild) sw.parentNode?.insertBefore(sw.firstChild, sw);
		sw.remove();
	});
}

export function extractTextLines(fo: Element): string[] {
	const lines: string[] = [];
	let current = "";
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			current += node.textContent?.trim() || "";
		} else if (node.instanceOf(Element)) {
			if (node.tagName.toLowerCase() === "br") {
				if (current) {
					lines.push(current);
					current = "";
				}
			} else {
				node.childNodes.forEach(walk);
			}
		}
	};
	fo.childNodes.forEach(walk);
	if (current) lines.push(current);
	return lines;
}

export function stripRootCss(svgEl: SVGSVGElement): void {
	svgEl.querySelectorAll("style").forEach((style) => {
		style.textContent = (style.textContent || "").replace(/:root\s*\{[^}]*\}/g, "");
	});
}

export function fixDimensions(svgEl: SVGSVGElement): void {
	const viewBox = svgEl.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
	const isAbsolute = (v: string | null) =>
		v != null && parseFloat(v) > 0 && /^\d+(\.\d+)?(px)?$/.test(v.trim());

	if (!isAbsolute(svgEl.getAttribute("width")) || !isAbsolute(svgEl.getAttribute("height"))) {
		if (viewBox?.length === 4) {
			svgEl.setAttribute("width", String(viewBox[2]));
			svgEl.setAttribute("height", String(viewBox[3]));
		} else {
			svgEl.setAttribute("width", "1200");
			svgEl.setAttribute("height", "800");
		}
	}
}
