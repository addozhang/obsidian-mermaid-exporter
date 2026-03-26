const MAX_CANVAS_DIMENSION = 16384;
const SVG_NS = "http://www.w3.org/2000/svg";

export function svgElementToPng(svgEl: SVGSVGElement, scale: number): Promise<Blob> {
	const cloned = svgEl.cloneNode(true) as SVGSVGElement;
	sanitizeSvg(cloned, svgEl);
	const svgString = new XMLSerializer().serializeToString(cloned);
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

			const canvas = document.createElement("canvas");
			canvas.width = canvasWidth;
			canvas.height = canvasHeight;
			const ctx = canvas.getContext("2d")!;
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
				"image/png",
			);
		};
		img.onerror = (e) => reject(new Error(`Failed to load SVG as image: ${e}`));
		img.src = dataUrl;
	});
}

function sanitizeSvg(svgEl: SVGSVGElement, originalSvgEl: SVGSVGElement): void {
	replaceForeignObjects(svgEl, originalSvgEl);
	stripRootCss(svgEl);
	fixDimensions(svgEl);
	svgEl.removeAttribute("style");
}

function replaceForeignObjects(svgEl: SVGSVGElement, originalSvgEl: SVGSVGElement): void {
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
		const styledEl = originalFo?.querySelector("span, div, p") as HTMLElement | null;
		const computed = styledEl ? window.getComputedStyle(styledEl) : null;
		const fontSize = parseFloat(computed?.fontSize || "14");
		const fontFamily = computed?.fontFamily || "sans-serif";
		const fill = computed?.color || "#333";

		const textEl = document.createElementNS(SVG_NS, "text");
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
				const tspan = document.createElementNS(SVG_NS, "tspan");
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

function extractTextLines(fo: Element): string[] {
	const lines: string[] = [];
	let current = "";
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			current += node.textContent?.trim() || "";
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			if ((node as Element).tagName.toLowerCase() === "br") {
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

function stripRootCss(svgEl: SVGSVGElement): void {
	svgEl.querySelectorAll("style").forEach((style) => {
		style.textContent = (style.textContent || "").replace(/:root\s*\{[^}]*\}/g, "");
	});
}

function fixDimensions(svgEl: SVGSVGElement): void {
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
