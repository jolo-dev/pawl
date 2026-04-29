import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";

const [cdkStarlightTypeDoc, cdkTypeDocSidebarGroup] =
	createStarlightTypeDocPlugin();
const [lambdaStarlightTypeDoc, lambdaTypeDocSidebarGroup] =
	createStarlightTypeDocPlugin();

const common = {
	typeDoc: {
		plugin: ["typedoc-plugin-mermaid", "typedoc-plugin-zod"],
	},
	tsconfig: "../tsconfig.build.json",
};

// https://astro.build/config
export default defineConfig({
	outDir: "../public",
	// publicDir: "public",
	base: process.env.NODE_ENV === "production" ? "/pawl/" : ".",
	integrations: [
		starlight({
			title: "pawl",
			logo: {
				dark: "./src/assets/pawl-logo-dark.png",
				light: "./src/assets/pawl-logo.png",
			},
			customCss: ["./src/fonts/font-face.css", "./src/styles/custom.css"],
			sidebar: [
				{
					label: "Libraries",
					items: [
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
