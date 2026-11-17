import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	cleanRootStyle,
	extractTextLines,
	fixDimensions,
	replaceForeignObjects,
	resolveBackground,
	resolveCssVariables,
	resolveVarsInString,
	sanitizeSvg,
	stripRootCss,
	svgElementToPng,
} from "../src/svgToPng";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(inner = ""): SVGSVGElement {
	const doc = new DOMParser().parseFromString(
		`<svg xmlns="${SVG_NS}">${inner}</svg>`,
		"image/svg+xml",
	);
	return doc.documentElement as unknown as SVGSVGElement;
}

function makeForeignObject(htmlInner: string, attrs: Record<string, string> = {}): Element {
	const fo = document.createElementNS(SVG_NS, "foreignObject");
	for (const [k, v] of Object.entries(attrs)) fo.setAttribute(k, v);
	// Create the XHTML body via innerHTML on a div so jsdom parses the markup.
	const wrapper = document.createElement("div");
	wrapper.innerHTML = htmlInner;
	while (wrapper.firstChild) fo.appendChild(wrapper.firstChild);
	return fo;
}

describe("extractTextLines", () => {
	it("returns a single line for plain text", () => {
		const fo = makeForeignObject("<span>Hello world</span>");
		expect(extractTextLines(fo)).toEqual(["Hello world"]);
	});

	it("splits text on <br> tags", () => {
		const fo = makeForeignObject("<span>line one<br>line two</span>");
		expect(extractTextLines(fo)).toEqual(["line one", "line two"]);
	});

	it("handles multiple <br> producing multiple lines", () => {
		const fo = makeForeignObject("<div>a<br>b<br>c</div>");
		expect(extractTextLines(fo)).toEqual(["a", "b", "c"]);
	});

	it("walks nested elements and trims text nodes", () => {
		const fo = makeForeignObject(
			"<div><span><b>bold</b></span><br><span>tail</span></div>",
		);
		expect(extractTextLines(fo)).toEqual(["bold", "tail"]);
	});

	it("returns empty array when no text present", () => {
		const fo = makeForeignObject("");
		expect(extractTextLines(fo)).toEqual([]);
	});

	it("ignores leading <br> with empty current buffer", () => {
		const fo = makeForeignObject("<div><br>after</div>");
		expect(extractTextLines(fo)).toEqual(["after"]);
	});
});

describe("stripRootCss", () => {
	it("removes :root { ... } blocks from style tags", () => {
		const svg = makeSvg(
			`<style>:root { --x: 1px; } .node { fill: red; }</style>`,
		);
		stripRootCss(svg);
		const css = svg.querySelector("style")?.textContent ?? "";
		expect(css).not.toContain(":root");
		expect(css).toContain(".node");
	});

	it("handles multiple style elements", () => {
		const svg = makeSvg(
			`<style>:root{--a:1}</style><style>:root { --b: 2 } .x{fill:#000}</style>`,
		);
		stripRootCss(svg);
		const all = Array.from(svg.querySelectorAll("style")).map((s) => s.textContent || "");
		expect(all.join("")).not.toContain(":root");
		expect(all.join("")).toContain(".x");
	});

	it("is a no-op when no :root rule is present", () => {
		const svg = makeSvg(`<style>.x{fill:#000}</style>`);
		stripRootCss(svg);
		expect(svg.querySelector("style")?.textContent).toBe(".x{fill:#000}");
	});

	it("does nothing when there are no style tags", () => {
		const svg = makeSvg(`<g></g>`);
		expect(() => stripRootCss(svg)).not.toThrow();
	});
});

describe("fixDimensions", () => {
	it("leaves valid absolute width/height untouched", () => {
		const svg = makeSvg();
		svg.setAttribute("width", "300");
		svg.setAttribute("height", "200");
		fixDimensions(svg);
		expect(svg.getAttribute("width")).toBe("300");
		expect(svg.getAttribute("height")).toBe("200");
	});

	it("keeps absolute px units", () => {
		const svg = makeSvg();
		svg.setAttribute("width", "300px");
		svg.setAttribute("height", "200px");
		fixDimensions(svg);
		expect(svg.getAttribute("width")).toBe("300px");
		expect(svg.getAttribute("height")).toBe("200px");
	});

	it("falls back to viewBox when width/height are missing", () => {
		const svg = makeSvg();
		svg.setAttribute("viewBox", "0 0 640 480");
		fixDimensions(svg);
		expect(svg.getAttribute("width")).toBe("640");
		expect(svg.getAttribute("height")).toBe("480");
	});

	it("falls back to viewBox when width/height are non-absolute (e.g. 100%)", () => {
		const svg = makeSvg();
		svg.setAttribute("width", "100%");
		svg.setAttribute("height", "100%");
		svg.setAttribute("viewBox", "0 0 800 600");
		fixDimensions(svg);
		expect(svg.getAttribute("width")).toBe("800");
		expect(svg.getAttribute("height")).toBe("600");
	});

	it("falls back to 1200x800 when neither viewBox nor absolute dims are present", () => {
		const svg = makeSvg();
		svg.setAttribute("width", "auto");
		fixDimensions(svg);
		expect(svg.getAttribute("width")).toBe("1200");
		expect(svg.getAttribute("height")).toBe("800");
	});

	it("supports comma separators in viewBox", () => {
		const svg = makeSvg();
		svg.setAttribute("viewBox", "0,0,100,50");
		fixDimensions(svg);
		expect(svg.getAttribute("width")).toBe("100");
		expect(svg.getAttribute("height")).toBe("50");
	});
});

describe("replaceForeignObjects", () => {
	it("replaces a single-line foreignObject with a centered <text> node", () => {
		const fo = makeForeignObject("<span>Hello</span>", {
			x: "10",
			y: "20",
			width: "100",
			height: "40",
		});
		const svg = makeSvg();
		svg.appendChild(fo);
		// Same structure on the "original" tree (the helper reads computed style off it).
		const original = svg.cloneNode(true) as SVGSVGElement;

		replaceForeignObjects(svg, original);

		expect(svg.querySelector("foreignObject")).toBeNull();
		const text = svg.querySelector("text");
		expect(text).not.toBeNull();
		expect(text?.getAttribute("text-anchor")).toBe("middle");
		expect(text?.getAttribute("x")).toBe("60"); // 10 + 100/2
		expect(text?.getAttribute("y")).toBe("40"); // 20 + 40/2
		expect(text?.getAttribute("dominant-baseline")).toBe("middle");
		expect(text?.textContent).toBe("Hello");
	});

	it("emits one <tspan> per line for multiline foreignObjects", () => {
		const fo = makeForeignObject("<span>line a<br>line b<br>line c</span>", {
			x: "0",
			y: "0",
			width: "200",
			height: "90",
		});
		const svg = makeSvg();
		svg.appendChild(fo);
		const original = svg.cloneNode(true) as SVGSVGElement;

		replaceForeignObjects(svg, original);

		const tspans = svg.querySelectorAll("tspan");
		expect(tspans.length).toBe(3);
		expect(Array.from(tspans).map((t) => t.textContent)).toEqual([
			"line a",
			"line b",
			"line c",
		]);
		// All tspans share the same x (horizontal center).
		const xs = new Set(Array.from(tspans).map((t) => t.getAttribute("x")));
		expect(xs.size).toBe(1);
		expect(xs.has("100")).toBe(true); // 0 + 200/2
	});

	it("removes empty foreignObjects entirely", () => {
		const fo = makeForeignObject("", { x: "0", y: "0", width: "50", height: "20" });
		const svg = makeSvg();
		svg.appendChild(fo);
		const original = svg.cloneNode(true) as SVGSVGElement;

		replaceForeignObjects(svg, original);

		expect(svg.querySelector("foreignObject")).toBeNull();
		expect(svg.querySelector("text")).toBeNull();
	});

	it("unwraps <switch> elements, preserving their children", () => {
		const svg = makeSvg(
			`<switch><g id="kept"><rect/></g></switch>`,
		);
		const original = svg.cloneNode(true) as SVGSVGElement;
		replaceForeignObjects(svg, original);
		expect(svg.querySelector("switch")).toBeNull();
		expect(svg.querySelector("#kept")).not.toBeNull();
		expect(svg.querySelector("rect")).not.toBeNull();
	});
});

describe("resolveVarsInString", () => {
	const lookup = (vars: Record<string, string>) => (name: string) => vars[name];

	it("substitutes a variable that is defined", () => {
		expect(resolveVarsInString("var(--_fg)", lookup({ "--_fg": "#dadada" }))).toBe("#dadada");
	});

	it("falls back to the declaration's default when the variable is missing", () => {
		expect(resolveVarsInString("var(--_fg,#1f1f1f)", lookup({}))).toBe("#1f1f1f");
	});

	it("prefers the resolved variable over the fallback", () => {
		expect(
			resolveVarsInString("var(--_fg,#1f1f1f)", lookup({ "--_fg": "rgb(1, 2, 3)" })),
		).toBe("rgb(1, 2, 3)");
	});

	it("resolves nested fallbacks", () => {
		expect(resolveVarsInString("var(--a, var(--b, #fff))", lookup({ "--b": "#000" }))).toBe("#000");
		expect(resolveVarsInString("var(--a, var(--b, #fff))", lookup({}))).toBe("#fff");
	});

	it("drops references that are neither defined nor have a fallback", () => {
		expect(resolveVarsInString("var(--nope)", lookup({}))).toBe("");
	});

	it("keeps surrounding text and handles several references per value", () => {
		expect(
			resolveVarsInString("rx:var(--_r);fill:var(--_s,#eee)", lookup({ "--_r": "4px", "--_s": "#222" })),
		).toBe("rx:4px;fill:#222");
	});

	it("leaves balanced-free input untouched", () => {
		expect(resolveVarsInString("#ffffff", lookup({}))).toBe("#ffffff");
	});

	it("ignores unbalanced var( without throwing", () => {
		expect(resolveVarsInString("var(--x", lookup({}))).toBe("var(--x");
	});
});

describe("resolveCssVariables", () => {
	// Mirrors Pele's root style: private aliases pointing at the public
	// --pele-* tokens with the light theme as the declared default.
	const PELE_ROOT_STYLE =
		"--_fg:var(--pele-fg,#1f1f1f);--_l:var(--pele-line,#2f2f2f);" +
		"--_s:var(--pele-surface,#f3f3f3);--_r:var(--pele-radius,4px)";

	it("bakes declared defaults into attributes when the live tree has no value (jsdom)", () => {
		const svg = makeSvg(
			`<g stroke="var(--_l)"><rect fill="var(--_s,#f3f3f3)" style="rx:var(--_r);fill:#ffe"/></g>`,
		);
		svg.setAttribute("style", PELE_ROOT_STYLE);
		const original = svg.cloneNode(true) as SVGSVGElement;

		resolveCssVariables(svg, original);

		const g = svg.querySelector("g");
		const rect = svg.querySelector("rect");
		expect(g?.getAttribute("stroke")).toBe("#2f2f2f");
		expect(rect?.getAttribute("fill")).toBe("#f3f3f3");
		expect(rect?.getAttribute("style")).toBe("rx:4px;fill:#ffe");
	});

	it("falls back to the attribute's own default when nothing declares the variable", () => {
		const svg = makeSvg(`<rect fill="var(--unknown,#abcdef)"/>`);
		const original = svg.cloneNode(true) as SVGSVGElement;
		resolveCssVariables(svg, original);
		expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#abcdef");
	});

	it("leaves attributes without var() untouched", () => {
		const svg = makeSvg(`<rect fill="#abcdef"/>`);
		const original = svg.cloneNode(true) as SVGSVGElement;
		resolveCssVariables(svg, original);
		expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#abcdef");
	});

	it("does not loop on self-referential declarations", () => {
		const svg = makeSvg(`<rect fill="var(--loop)"/>`);
		svg.setAttribute("style", "--loop:var(--loop)");
		const original = svg.cloneNode(true) as SVGSVGElement;
		expect(() => resolveCssVariables(svg, original)).not.toThrow();
		expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("");
	});
});

describe("cleanRootStyle", () => {
	it("keeps plain declarations but drops custom properties and layout props", () => {
		const svg = makeSvg();
		svg.setAttribute(
			"style",
			"max-width:100%;height:auto;--_fg:#dadada;color:#dadada;font:16px sans-serif",
		);
		cleanRootStyle(svg);
		const style = svg.getAttribute("style") ?? "";
		expect(style).not.toContain("--_fg");
		expect(style).not.toContain("max-width");
		expect(style).not.toContain("height");
		expect(style).toContain("color:#dadada");
		expect(style).toContain("font:16px sans-serif");
	});

	it("removes the attribute entirely when nothing is left", () => {
		const svg = makeSvg();
		svg.setAttribute("style", "max-width:100%;--_fg:#fff");
		cleanRootStyle(svg);
		expect(svg.hasAttribute("style")).toBe(false);
	});

	it("is a no-op without a style attribute", () => {
		const svg = makeSvg();
		expect(() => cleanRootStyle(svg)).not.toThrow();
		expect(svg.hasAttribute("style")).toBe(false);
	});
});

describe("resolveBackground", () => {
	it("defaults to white when the diagram defines no background variable", () => {
		const svg = makeSvg();
		expect(resolveBackground(svg)).toBe("#ffffff");
	});
});

describe("sanitizeSvg on real Pele output (Obsidian ≥ 1.15)", () => {
	const fixture = readFileSync(`${process.cwd()}/test/fixtures/pele-flowchart.svg`, "utf8");

	function loadFixture(): SVGSVGElement {
		return new DOMParser()
			.parseFromString(fixture, "image/svg+xml")
			.documentElement as unknown as SVGSVGElement;
	}

	it("leaves no unresolved var() reference behind", () => {
		const clone = loadFixture();
		const original = loadFixture();
		sanitizeSvg(clone, original);

		const serialized = new XMLSerializer().serializeToString(clone);
		expect(serialized).not.toContain("var(");
	});

	it("keeps concrete colors on shapes, edges and labels", () => {
		const clone = loadFixture();
		const original = loadFixture();
		sanitizeSvg(clone, original);

		const node = clone.querySelector(".pele-node[data-id='A'] rect");
		expect(node?.getAttribute("fill")).toBe("#f3f3f3");
		expect(node?.getAttribute("stroke")).toBe("#8a8a8a");
		expect(clone.querySelector(".pele-edges")?.getAttribute("stroke")).toBe("#1f1f1f");
		expect(clone.querySelector(".pele-node[data-id='A'] text")?.textContent).toBe("开始");
	});

	it("drops responsive sizing so the intrinsic size survives", () => {
		const clone = loadFixture();
		const original = loadFixture();
		sanitizeSvg(clone, original);

		expect(clone.getAttribute("style")).not.toContain("max-width");
		expect(clone.getAttribute("width")).toBe("383");
		expect(clone.getAttribute("height")).toBe("84");
	});
});

describe("svgElementToPng (happy path with stubs)", () => {
	it("sanitizes the SVG and resolves with a PNG blob", async () => {
		// Stub Image so jsdom doesn't actually try to decode the data URL.
		class FakeImage {
			naturalWidth = 100;
			naturalHeight = 50;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			set src(_v: string) {
				// Trigger onload on the next tick to mirror the real Image behavior.
				setTimeout(() => this.onload?.(), 0);
			}
		}
		(globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;

		// Stub createEl (Obsidian helper) — return a real <canvas>, then patch toBlob.
		(globalThis as unknown as { createEl: (tag: string) => HTMLElement }).createEl = (
			tag: string,
		) => document.createElement(tag);

		const svg = makeSvg(`<rect width="10" height="10"/>`);
		svg.setAttribute("width", "100");
		svg.setAttribute("height", "50");

		// jsdom canvas has no real toBlob; patch it on the prototype.
		HTMLCanvasElement.prototype.getContext = function () {
			return {
				fillStyle: "",
				fillRect: () => undefined,
				drawImage: () => undefined,
			} as unknown as CanvasRenderingContext2D;
		} as unknown as HTMLCanvasElement["getContext"];
		HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
			cb(new Blob(["png"], { type: "image/png" }));
		};

		const blob = await svgElementToPng(svg, 1);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe("image/png");
	});
});
