import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";

// Local fork of typedoc-plugin-mermaid that also registers the mermaid icon
// packs (logos, hugeicons) used by architecture-beta diagrams. Must be an
// absolute path: TypeDoc resolves relative plugin paths against its own module.
const mermaidPlugin = fileURLToPath(
	new URL("./typedoc-plugin-mermaid.mjs", import.meta.url),
);

const [cdkStarlightTypeDoc, cdkTypeDocSidebarGroup] =
	createStarlightTypeDocPlugin();
const [lambdaStarlightTypeDoc, lambdaTypeDocSidebarGroup] =
	createStarlightTypeDocPlugin();

const common = {
	typeDoc: {
		plugin: [mermaidPlugin, "typedoc-plugin-zod"],
	},
	tsconfig: "./tsconfig.typedoc.json",
};

// https://astro.build/config
export default defineConfig({
	outDir: "../public",
	// publicDir: "public",
	base: process.env.NODE_ENV === "production" ? "/pawl/" : ".",
	integrations: [
		starlight({
			title: "pawl",
			components: {
				ThemeProvider: "./src/overrides/ThemeProvider.astro",
				ThemeSelect: "./src/overrides/ThemeSelect.astro",
			},
			logo: {
				dark: "./src/assets/pawl-logo-no-text.png",
				light: "./src/assets/pawl-logo-no-text.png",
			},
			customCss: ["./src/fonts/font-face.css", "./src/styles/custom.css"],
			sidebar: [
				{
					link: "lib/intro",
					label: "Introduction",
				},
				{
					label: "AWS CDK",
					items: [
						"lib/cdk",
						"lib/cdk-localdevelopment",
						"lib/cdk-tutorial",
						"lib/cdk-readme",
						cdkTypeDocSidebarGroup,
					],
				},
				{
					label: "AWS Lambda",
					items: [
						"lib/lambda",
						"lib/lambda-localdevelopment",
						"lib/lambda-tutorial",
						"lib/lambda-readme",
						lambdaTypeDocSidebarGroup,
					],
				},
			],
			plugins: [
				cdkStarlightTypeDoc({
					entryPoints: ["../packages/cdk/index.ts"],
					output: "cdk",
					...common,
				}),
				lambdaStarlightTypeDoc({
					entryPoints: ["../packages/lambda/index.ts"],
					output: "lambda",
					...common,
				}),
			],
		}),
	],
});
