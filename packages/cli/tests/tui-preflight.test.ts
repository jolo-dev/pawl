import { describe, expect, test } from "bun:test";
import type { BedrockModelGroup } from "../src/bedrock-models";
import {
	BACK,
	type PreflightDeps,
	type PreflightPrompter,
	runPreflight,
	type SelectResult,
} from "../src/tui/preflight";

const groups: BedrockModelGroup[] = [
	{
		baseId: "anthropic.claude-sonnet-4-6",
		provider: "anthropic",
		name: "Claude Sonnet 4.6",
		scopes: [
			"eu.anthropic.claude-sonnet-4-6",
			"us.anthropic.claude-sonnet-4-6",
		],
	},
	{
		baseId: "amazon.nova-2-lite-v1:0",
		provider: "amazon",
		name: "Nova 2 Lite",
		scopes: ["eu.amazon.nova-2-lite-v1:0"],
	},
];

function deps(over: Partial<PreflightDeps> = {}): PreflightDeps {
	return {
		listProfiles: async () => ["dev", "prod"],
		profileRegion: async () => "eu-central-1",
		isSso: async () => false,
		isSsoTokenValid: async () => true,
		checkCredentials: async () => {},
		ssoLogin: async () => {},
		listModelGroups: async () => groups,
		checkBedrockAccess: async () => true,
		...over,
	};
}

interface Scripted {
	readonly prompter: PreflightPrompter;
	readonly asked: string[];
	readonly statuses: string[];
}

/**
 * Answers by question id in the order the machine asks, so a test says what it
 * chose rather than replaying a call sequence.
 */
function scripted(answers: Record<string, SelectResult | string>): Scripted {
	const asked: string[] = [];
	const statuses: string[] = [];
	let cursor = 0;
	const next = (id: string): SelectResult | string => {
		asked.push(id);
		const queue = answers[`${id}${cursor}`];
		if (queue !== undefined) {
			cursor++;
			return queue;
		}
		const value = answers[id];
		if (Array.isArray(value)) return (value as string[]).shift() ?? null;
		return value ?? null;
	};
	return {
		asked,
		statuses,
		prompter: {
			async select(input) {
				const value = next(input.id);
				if (typeof value === "symbol" || value === null)
					return value as SelectResult;
				// A scripted array means "answer in this order each time".
				return value as string;
			},
			async text(input) {
				const value = next(input.id);
				if (value === null || typeof value === "symbol") return null;
				return value as string;
			},
			status(message) {
				statuses.push(message);
			},
		},
	};
}

describe("runPreflight", () => {
	test("resolves a profile, region and model for a non-SSO profile", async () => {
		const { prompter } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		const outcome = await runPreflight(deps(), prompter);

		expect(outcome).toEqual({
			ok: true,
			result: {
				profile: "dev",
				region: "eu-central-1",
				modelId: "eu.amazon.nova-2-lite-v1:0",
				modelName: "Nova 2 Lite",
			},
		});
	});

	test("skips the scope question when a model has only one profile", async () => {
		const { prompter, asked } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		await runPreflight(deps(), prompter);

		expect(asked).not.toContain("scope");
	});

	test("asks which inference profile when there is a choice", async () => {
		const { prompter, asked } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "anthropic",
			model: "anthropic.claude-sonnet-4-6",
			scope: "us.anthropic.claude-sonnet-4-6",
		});

		const outcome = await runPreflight(deps(), prompter);

		expect(asked).toContain("scope");
		expect(outcome.ok && outcome.result.modelId).toBe(
			"us.anthropic.claude-sonnet-4-6",
		);
	});

	test("goes back to the provider list from the model list", async () => {
		let modelAsked = 0;
		const asked: string[] = [];
		const prompter: PreflightPrompter = {
			async select(input) {
				asked.push(input.id);
				if (input.id === "profile") return "dev";
				if (input.id === "provider")
					return asked.filter((id) => id === "provider").length === 1
						? "anthropic"
						: "amazon";
				if (input.id === "model") {
					modelAsked++;
					return modelAsked === 1 ? BACK : "amazon.nova-2-lite-v1:0";
				}
				return null;
			},
			async text() {
				return "eu-central-1";
			},
			status() {},
		};

		const outcome = await runPreflight(deps(), prompter);

		expect(outcome.ok && outcome.result.modelName).toBe("Nova 2 Lite");
	});

	test("logs in when the SSO token has expired", async () => {
		const logins: string[] = [];
		const { prompter } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		const outcome = await runPreflight(
			deps({
				isSso: async () => true,
				isSsoTokenValid: async () => false,
				ssoLogin: async (profile) => {
					logins.push(profile);
				},
			}),
			prompter,
		);

		expect(logins).toEqual(["dev"]);
		expect(outcome.ok).toBe(true);
	});

	test("does not log in again when the SSO token is still valid", async () => {
		const logins: string[] = [];
		const { prompter } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		await runPreflight(
			deps({
				isSso: async () => true,
				isSsoTokenValid: async () => true,
				ssoLogin: async (profile) => {
					logins.push(profile);
				},
			}),
			prompter,
		);

		expect(logins).toEqual([]);
	});

	test("fails with the profile named when credentials are rejected", async () => {
		const { prompter } = scripted({ profile: "prod" });

		const outcome = await runPreflight(
			deps({
				checkCredentials: async () => {
					throw new Error("expired");
				},
			}),
			prompter,
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.reason).toContain('"prod"');
		expect(outcome.cancelled).toBe(false);
	});

	test("fails when no profiles exist, without asking anything", async () => {
		const { prompter, asked } = scripted({});

		const outcome = await runPreflight(
			deps({ listProfiles: async () => [] }),
			prompter,
		);

		expect(outcome.ok).toBe(false);
		expect(asked).toEqual([]);
	});

	test("fails when the region has no models", async () => {
		const { prompter } = scripted({ profile: "dev", region: "eu-central-1" });

		const outcome = await runPreflight(
			deps({ listModelGroups: async () => [] }),
			prompter,
		);

		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.reason).toContain("No text models");
	});

	test("fails when Bedrock access is denied", async () => {
		const { prompter } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		const outcome = await runPreflight(
			deps({ checkBedrockAccess: async () => false }),
			prompter,
		);

		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.reason).toContain("No Bedrock access");
			expect(outcome.cancelled).toBe(false);
		}
	});

	test("reports cancellation as cancellation, not as a failure", async () => {
		const { prompter } = scripted({ profile: null });

		const outcome = await runPreflight(deps(), prompter);

		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.cancelled).toBe(true);
	});

	test("reports progress so a slow AWS call is not a frozen screen", async () => {
		const { prompter, statuses } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		await runPreflight(deps(), prompter);

		expect(statuses.join("\n")).toContain("Checking credentials");
		expect(statuses.join("\n")).toContain("Checking Bedrock access");
	});
});
