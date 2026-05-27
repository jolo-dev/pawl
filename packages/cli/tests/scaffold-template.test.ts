import { describe, expect, test } from "bun:test";
import { getTemplateManifest, renderTemplate } from "../src/scaffold/template";

describe("getTemplateManifest", () => {
	test("includes local.dev.ts for LocalStack", () => {
		const manifest = getTemplateManifest({ testMode: "localstack" });
		expect(manifest.files).toContain("local.dev.ts");
		expect(manifest.files).toContain("tests/integration.test.ts");
	});

	test("omits local.dev.ts for none", () => {
		const manifest = getTemplateManifest({ testMode: "none" });
		expect(manifest.files).not.toContain("local.dev.ts");
		expect(manifest.files).toContain("tests/integration.test.ts");
	});
});

describe("renderTemplate", () => {
	test("replaces core placeholders", () => {
		const rendered = renderTemplate(
			"name={{projectName}} manager={{packageManager}} profile={{awsProfile}} mode={{testMode}}",
			{
				projectName: "my-app",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "localstack",
			},
		);
		expect(rendered).toBe(
			"name=my-app manager=bun profile=dev mode=localstack",
		);
	});
});
