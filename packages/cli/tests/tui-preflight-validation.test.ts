import { describe, expect, test } from "bun:test";
import type { BedrockModelGroup } from "../src/bedrock-models";
import type {
	PreflightDeps,
	PreflightPrompter,
	PreflightSuccess,
} from "../src/tui/preflight";
import { validateSavedSelection } from "../src/tui/preflight-validation";

const selection: PreflightSuccess = {
	profile: "dev",
	region: "eu-central-1",
	modelId: "eu.amazon.nova-2-lite-v1:0",
	modelName: "Old cached name",
};
const groups: BedrockModelGroup[] = [
	{
		baseId: "amazon.nova-2-lite-v1:0",
		provider: "amazon",
		name: "Nova 2 Lite",
		scopes: [selection.modelId],
	},
];

function fixture(overrides: Partial<PreflightDeps> = {}) {
	const calls: string[] = [];
	const notices: string[] = [];
	const deps: PreflightDeps = {
		listProfiles: async () => {
			calls.push("profiles");
			return ["dev"];
		},
		profileRegion: async () => {
			throw new Error("Saved region must not be replaced by configuration");
		},
		isSso: async () => {
			calls.push("config");
			return false;
		},
		isSsoTokenValid: async () => {
			calls.push("token");
			return false;
		},
		ssoLogin: async (profile, report) => {
			calls.push(`login:${profile}`);
			report("https://example.invalid/verify");
		},
		checkCredentials: async (profile, region) => {
			calls.push(`credentials:${profile}:${region}`);
		},
		listModelGroups: async (profile, region) => {
			calls.push(`catalog:${profile}:${region}`);
			return groups;
		},
		checkBedrockAccess: async (profile, region) => {
			calls.push(`access:${profile}:${region}`);
			return true;
		},
		...overrides,
	};
	const prompter: PreflightPrompter = {
		select: async () => {
			throw new Error("Saved validation must not ask selection questions");
		},
		text: async () => {
			throw new Error("Saved validation must not ask text questions");
		},
		status() {},
		notice: (message) => notices.push(message),
	};
	return { deps, prompter, calls, notices };
}

describe("validateSavedSelection", () => {
	test("accepts the exact scope and refreshes the display name from the live catalog", async () => {
		const { deps, prompter, calls } = fixture();
		expect(await validateSavedSelection(deps, prompter, selection)).toEqual({
			ok: true,
			result: { ...selection, modelName: "Nova 2 Lite" },
		});
		expect(calls).toEqual([
			"profiles",
			"config",
			"credentials:dev:eu-central-1",
			"catalog:dev:eu-central-1",
			"access:dev:eu-central-1",
		]);
	});

	test.each([
		"us.amazon.nova-2-lite-v1:0",
		"amazon.nova-2-lite-v1:0",
	])("rejects a removed exact scope despite the matching base model with scope %s", async (scope) => {
		const { deps, prompter, calls } = fixture({
			listModelGroups: async () =>
				groups.map((group) => ({ ...group, scopes: [scope] })),
		});
		const outcome = await validateSavedSelection(deps, prompter, selection);
		expect(outcome).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining(selection.modelId),
		});
		expect(calls.some((call) => call.startsWith("access:"))).toBe(false);
	});

	test("rejects a removed profile before reading configuration or authenticating", async () => {
		const { deps, prompter, calls } = fixture();
		const outcome = await validateSavedSelection(deps, prompter, {
			...selection,
			profile: "removed",
		});
		expect(outcome).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining('"removed"'),
		});
		expect(calls).toEqual(["profiles"]);
	});

	test.each([
		["no profiles", { listProfiles: async () => [] }, "No AWS profiles"],
		["empty catalog", { listModelGroups: async () => [] }, "No text models"],
		[
			"access denied",
			{ checkBedrockAccess: async () => false },
			"No Bedrock access",
		],
	] satisfies [
		string,
		Partial<PreflightDeps>,
		string,
	][])("returns a failure for %s", async (_name, overrides, reason) => {
		const { deps, prompter } = fixture(overrides);
		expect(await validateSavedSelection(deps, prompter, selection)).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining(reason),
		});
	});

	test.each([
		["listProfiles", "Could not read AWS profiles"],
		["isSso", "Could not read the profile's configuration"],
		["isSsoTokenValid", "SSO login failed"],
		["ssoLogin", "SSO login failed"],
		["checkCredentials", 'Credentials are not valid for profile "dev"'],
		["listModelGroups", "Could not list Bedrock models"],
		["checkBedrockAccess", "Could not check Bedrock access"],
	] as const)("returns an explained failure when %s throws", async (stage, reason) => {
		const { deps, prompter } = fixture({
			isSso: async () => true,
			[stage]: async () => {
				throw new Error("test failure");
			},
		});
		const outcome = await validateSavedSelection(deps, prompter, selection);
		expect(outcome).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining(reason),
		});
		if (!outcome.ok) expect(outcome.reason).toContain("test failure");
	});

	test.each([
		false,
		true,
	])("validates role credentials after SSO token check (valid=%s)", async (valid) => {
		const { deps, prompter, calls, notices } = fixture({
			isSso: async () => true,
			isSsoTokenValid: async () => valid,
		});
		expect((await validateSavedSelection(deps, prompter, selection)).ok).toBe(
			true,
		);
		expect(calls).toEqual([
			"profiles",
			...(valid ? [] : ["login:dev"]),
			"credentials:dev:eu-central-1",
			"catalog:dev:eu-central-1",
			"access:dev:eu-central-1",
		]);
		expect(notices).toEqual(valid ? [] : ["https://example.invalid/verify"]);
	});

	test.each([
		false,
		true,
	])("rejects unusable SSO role credentials even after token validation (valid=%s)", async (valid) => {
		const { deps, prompter, calls } = fixture({
			isSso: async () => true,
			isSsoTokenValid: async () => valid,
			checkCredentials: async () => {
				throw new Error("role denied");
			},
		});
		expect(await validateSavedSelection(deps, prompter, selection)).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining("role denied"),
		});
		expect(calls.some((call) => call.startsWith("catalog:"))).toBe(false);
	});
});
