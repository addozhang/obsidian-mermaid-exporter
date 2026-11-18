// Mirror of the checks the community-directory review runs, so the same
// findings surface locally instead of in a rejection email.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores([
		"node_modules",
		"main.js",
		"esbuild.config.mjs",
		"coverage",
		// Not plugin code, and outside tsconfig: the CDP harness scripts and tests.
		"scripts/**",
		"test/**",
		"vitest.config.ts",
	]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs"],
				},
			},
		},
	},
]);
