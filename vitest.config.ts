import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "test/__mocks__/obsidian.ts"),
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./test/setup.ts"],
		include: ["test/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/svgToPng.ts"],
			reporter: ["text", "html"],
			thresholds: {
				"src/svgToPng.ts": {
					lines: 70,
					statements: 70,
					functions: 70,
					branches: 70,
				},
			},
		},
	},
});
