import { describe, expect, test } from "bun:test";
import type { SelectOptions } from "@clack/prompts";
import { createClackPrompter } from "../src/tui/clack-prompter";
import { BACK } from "../src/tui/preflight";

const options = [
	{ value: "dev", label: "Development" },
	{ value: "prod", label: "Production" },
];

describe("createClackPrompter select", () => {
	test("forwards options, message and initial selection to Clack", async () => {
		const requests: SelectOptions<string>[] = [];
		const prompter = createClackPrompter(async (request) => {
			requests.push(request);
			return "prod";
		});
		expect(
			await prompter.select({
				id: "profile",
				message: "Select an AWS profile",
				options,
				initialValue: "prod",
			}),
		).toBe("prod");
		expect(requests).toEqual([
			{
				message: "Select an AWS profile",
				options,
				initialValue: "prod",
			},
		]);
	});

	test("keeps an absent initial selection undefined and does not add Back", async () => {
		const requests: SelectOptions<string>[] = [];
		const prompter = createClackPrompter(async (request) => {
			requests.push(request);
			return "dev";
		});
		expect(
			await prompter.select({ id: "profile", message: "Profile", options }),
		).toBe("dev");
		expect(requests).toHaveLength(1);
		expect(requests[0]?.initialValue).toBeUndefined();
		expect(requests[0]?.options).toEqual(options);
	});

	test("appends and maps Back without mutating options or losing the initial selection", async () => {
		const requests: SelectOptions<string>[] = [];
		const prompter = createClackPrompter(async (request) => {
			requests.push(request);
			return request.options.at(-1)?.value ?? "missing";
		});
		expect(
			await prompter.select({
				id: "model",
				message: "Model",
				options,
				allowBack: true,
				initialValue: "prod",
			}),
		).toBe(BACK);
		expect(requests).toEqual([
			{
				message: "Model",
				options: [...options, { value: "__back__", label: "← Back" }],
				initialValue: "prod",
			},
		]);
		expect(options).toHaveLength(2);
	});

	test("does not map the Back sentinel when Back is not allowed", async () => {
		const prompter = createClackPrompter(async () => "__back__");
		expect(
			await prompter.select({
				id: "profile",
				message: "Profile",
				options: [{ value: "__back__", label: "Named profile" }],
			}),
		).toBe("__back__");
	});

	test.each([
		false,
		true,
	])("maps Clack symbol cancellation to null (Back allowed: %s)", async (allowBack) => {
		let calls = 0;
		const prompter = createClackPrompter(async () => {
			calls++;
			return Symbol("clack cancellation");
		});
		expect(
			await prompter.select({
				id: "model",
				message: "Model",
				options,
				initialValue: "prod",
				allowBack,
			}),
		).toBeNull();
		expect(calls).toBe(1);
	});
});
