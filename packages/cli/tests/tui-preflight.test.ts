import { describe, expect, test } from "bun:test";
import type { BedrockModelGroup } from "../src/bedrock-models";
import {
	BACK,
	type PreflightDeps,
	type PreflightPrompter,
	type PreflightSuccess,
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

type SelectRequest = Parameters<PreflightPrompter["select"]>[0];
type TextRequest = Parameters<PreflightPrompter["text"]>[0];

interface Scripted {
	readonly selections: SelectRequest[];
	readonly texts: TextRequest[];
	readonly prompter: PreflightPrompter;
	readonly asked: string[];
	readonly statuses: string[];
	readonly notices: string[];
}

/**
 * Answers by question id in the order the machine asks, so a test says what it
 * chose rather than replaying a call sequence.
 */
function scripted(answers: Record<string, SelectResult | string>): Scripted {
	const selections: SelectRequest[] = [];
	const texts: TextRequest[] = [];
	const asked: string[] = [];
	const statuses: string[] = [];
	const notices: string[] = [];
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
		selections,
		texts,
		asked,
		statuses,
		notices,
		prompter: {
			async select(input) {
				selections.push(input);
				const value = next(input.id);
				if (typeof value === "symbol" || value === null)
					return value as SelectResult;
				// A scripted array means "answer in this order each time".
				return value as string;
			},
			async text(input) {
				texts.push(input);
				const value = next(input.id);
				if (value === null || typeof value === "symbol") return null;
				return value as string;
			},
			status(message) {
				statuses.push(message);
			},
			notice(message) {
				notices.push(message);
			},
		},
	};
}

describe("runPreflight", () => {
	test.each([
		false,
		true,
	])("checks credentials in the chosen region after SSO (valid=%s)", async (valid) => {
		const calls: string[] = [];
		const { prompter } = scripted({
			profile: "dev",
			region: " us-west-2 ",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});
		const outcome = await runPreflight(
			deps({
				isSso: async () => true,
				isSsoTokenValid: async () => valid,
				ssoLogin: async () => {
					calls.push("login");
				},
				checkCredentials: async (profile, region) => {
					calls.push(`credentials:${profile}:${region}`);
				},
				listModelGroups: async (_profile, region) => {
					calls.push(`catalog:${region}`);
					return groups;
				},
			}),
			prompter,
		);
		expect(outcome.ok).toBe(true);
		expect(calls).toEqual([
			...(valid ? [] : ["login"]),
			"credentials:dev:us-west-2",
			"catalog:us-west-2",
		]);
	});

	test("returns profile-region lookup errors before authentication", async () => {
		const { prompter, asked } = scripted({
			profile: "dev",
			region: "eu-central-1",
		});
		let authenticated = false;
		const outcome = await runPreflight(
			deps({
				profileRegion: async () => {
					throw new Error("config unreadable");
				},
				checkCredentials: async () => {
					authenticated = true;
				},
			}),
			prompter,
		);
		expect(outcome).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining("config unreadable"),
		});
		expect(authenticated).toBe(false);
		expect(asked).toEqual(["profile"]);
	});

	test("rejects a non-listed profile returned by the prompter before configuration/authentication", async () => {
		const { prompter, asked } = scripted({
			profile: "arbitrary",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});
		const calls: string[] = [];
		const outcome = await runPreflight(
			deps({
				profileRegion: async () => {
					calls.push("region");
					return "eu-central-1";
				},
				isSso: async () => {
					calls.push("auth");
					return false;
				},
			}),
			prompter,
		);
		expect(outcome).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining('"arbitrary"'),
		});
		expect(calls).toEqual([]);
		expect(asked).toEqual(["profile"]);
	});

	test.each([
		"arbitrary.scope",
		"eu.amazon.nova-2-lite-v1:0",
	])("rejects a scope not offered for the selected group: %s", async (scope) => {
		const { prompter } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "anthropic",
			model: "anthropic.claude-sonnet-4-6",
			scope,
		});
		let accessChecked = false;
		const outcome = await runPreflight(
			deps({
				checkBedrockAccess: async () => {
					accessChecked = true;
					return true;
				},
			}),
			prompter,
		);
		expect(outcome).toEqual({
			ok: false,
			cancelled: false,
			reason: expect.stringContaining(scope),
		});
		expect(accessChecked).toBe(false);
	});

	test("goes back from scope to model and keeps the one-scope shortcut", async () => {
		const { prompter, asked } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "anthropic",
			model0: "anthropic.claude-sonnet-4-6",
			scope1: BACK,
			model2: BACK,
			provider3: "amazon",
			model4: "amazon.nova-2-lite-v1:0",
		});
		const outcome = await runPreflight(deps(), prompter);
		expect(outcome.ok && outcome.result.modelName).toBe("Nova 2 Lite");
		expect(asked).toEqual([
			"profile",
			"region",
			"provider",
			"model",
			"scope",
			"model",
			"provider",
			"model",
		]);
	});

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
			notice() {},
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

	test("puts the SSO login URL in the transcript, not on stdout", async () => {
		// The client owns the terminal, so a raw console.log would corrupt the
		// rendered UI and a status line would be replaced before the user could
		// finish logging in.
		const { prompter, notices } = scripted({
			profile: "dev",
			region: "eu-central-1",
			provider: "amazon",
			model: "amazon.nova-2-lite-v1:0",
		});

		await runPreflight(
			deps({
				isSso: async () => true,
				isSsoTokenValid: async () => false,
				ssoLogin: async (_profile, report) => {
					report(
						"Opening browser for SSO login:\nhttps://example.invalid/verify",
					);
				},
			}),
			prompter,
		);

		expect(notices.join("\n")).toContain("https://example.invalid/verify");
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
		const { prompter } = scripted({ profile: "prod", region: "eu-central-1" });

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

describe("runPreflight saved defaults", () => {
	const defaults: PreflightSuccess = {
		profile: "prod",
		region: "ap-southeast-2",
		modelId: "us.anthropic.claude-sonnet-4-6",
		modelName: "Stale display name",
	};
	const answers = {
		profile: defaults.profile,
		region: defaults.region,
		provider: "anthropic",
		model: "anthropic.claude-sonnet-4-6",
		scope: defaults.modelId,
	};
	const alternative: BedrockModelGroup = {
		baseId: "anthropic.other",
		provider: "anthropic",
		name: "Other model",
		scopes: ["eu.anthropic.other", "us.anthropic.other"],
	};

	test("preselects every saved choice from the live catalog, not the cached name", async () => {
		const { prompter, selections, texts } = scripted(answers);
		const outcome = await runPreflight(deps(), prompter, { defaults });
		expect(
			selections.map(({ id, initialValue }) => [id, initialValue]),
		).toEqual([
			["profile", "prod"],
			["provider", "anthropic"],
			["model", "anthropic.claude-sonnet-4-6"],
			["scope", defaults.modelId],
		]);
		expect(texts[0]?.initialValue).toBe(defaults.region);
		for (const request of selections) {
			expect(
				request.options.some(({ value }) => value === request.initialValue),
			).toBe(true);
		}
		expect(outcome).toEqual({
			ok: true,
			result: { ...defaults, modelName: "Claude Sonnet 4.6" },
		});
	});

	test("omits initial selections without saved defaults", async () => {
		const { prompter, selections, texts } = scripted(answers);
		expect((await runPreflight(deps(), prompter)).ok).toBe(true);
		for (const request of selections)
			expect(request.initialValue).toBeUndefined();
		expect(texts[0]?.initialValue).toBe("eu-central-1");
	});

	test("omits a missing profile and uses the selected profile's region", async () => {
		const { prompter, selections, texts } = scripted(answers);
		expect(
			(
				await runPreflight(deps(), prompter, {
					defaults: { ...defaults, profile: "removed" },
				})
			).ok,
		).toBe(true);
		expect(selections[0]?.initialValue).toBeUndefined();
		expect(selections[0]?.options.map(({ value }) => value)).toEqual([
			"dev",
			"prod",
		]);
		expect(texts[0]?.initialValue).toBe("eu-central-1");
	});

	test.each([
		"us-west-2",
		undefined,
	])("changing profile suggests its configured region or fallback (%s)", async (configured) => {
		const profiles: string[] = [];
		const { prompter, texts } = scripted({ ...answers, profile: "dev" });
		expect(
			(
				await runPreflight(
					deps({
						profileRegion: async (profile) => {
							profiles.push(profile);
							return configured;
						},
					}),
					prompter,
					{ defaults },
				)
			).ok,
		).toBe(true);
		expect(profiles).toEqual(["dev"]);
		expect(texts[0]?.initialValue).toBe(configured ?? "us-east-1");
	});

	test.each([
		"anthropic.claude-sonnet-4-6",
		"global.anthropic.claude-sonnet-4-6",
		"eu.removed.model",
	])("does not infer defaults from an unavailable exact scope: %s", async (modelId) => {
		const { prompter, selections } = scripted(answers);
		expect(
			(
				await runPreflight(deps(), prompter, {
					defaults: { ...defaults, modelId },
				})
			).ok,
		).toBe(true);
		for (const request of selections.filter(({ id }) => id !== "profile")) {
			expect(request.initialValue).toBeUndefined();
		}
	});

	test("recomputes defaults against the changed region's catalog", async () => {
		const regions: string[] = [];
		const { prompter, selections } = scripted({
			...answers,
			region: "eu-west-1",
			model: alternative.baseId,
			scope: "eu.anthropic.other",
		});
		expect(
			(
				await runPreflight(
					deps({
						listModelGroups: async (_profile, region) => {
							regions.push(region);
							return [alternative];
						},
					}),
					prompter,
					{ defaults },
				)
			).ok,
		).toBe(true);
		expect(regions).toEqual(["eu-west-1"]);
		for (const request of selections.filter(({ id }) => id !== "profile")) {
			expect(request.initialValue).toBeUndefined();
		}
	});

	test("changing provider clears incompatible model and scope defaults", async () => {
		const amazon: BedrockModelGroup = {
			baseId: "amazon.nova-2-lite-v1:0",
			provider: "amazon",
			name: "Nova 2 Lite",
			scopes: ["eu.amazon.nova-2-lite-v1:0", "us.amazon.nova-2-lite-v1:0"],
		};
		const { prompter, selections } = scripted({
			...answers,
			provider: "amazon",
			model: amazon.baseId,
			scope: "us.amazon.nova-2-lite-v1:0",
		});
		const outcome = await runPreflight(
			deps({
				listModelGroups: async () => [
					...groups.filter(({ provider }) => provider !== "amazon"),
					amazon,
				],
			}),
			prompter,
			{ defaults },
		);
		expect(outcome.ok && outcome.result.modelId).toBe(
			"us.amazon.nova-2-lite-v1:0",
		);
		expect(selections.find(({ id }) => id === "provider")?.initialValue).toBe(
			"anthropic",
		);
		for (const request of selections.filter(
			({ id }) => id === "model" || id === "scope",
		)) {
			expect(request.initialValue).toBeUndefined();
			expect(
				request.options.some(({ value }) => value === defaults.modelId),
			).toBe(false);
		}
	});

	test("changing model clears incompatible scope defaults", async () => {
		const { prompter, selections } = scripted({
			...answers,
			model: alternative.baseId,
			scope: "us.anthropic.other",
		});
		const outcome = await runPreflight(
			deps({
				listModelGroups: async () => [...groups, alternative],
			}),
			prompter,
			{ defaults },
		);
		expect(outcome.ok && outcome.result.modelId).toBe("us.anthropic.other");
		expect(selections.find(({ id }) => id === "model")?.initialValue).toBe(
			"anthropic.claude-sonnet-4-6",
		);
		expect(
			selections.find(({ id }) => id === "scope")?.initialValue,
		).toBeUndefined();
	});

	test("Back reapplies only defaults available at each step", async () => {
		const { prompter, selections } = scripted({
			...answers,
			model0: "anthropic.claude-sonnet-4-6",
			scope1: BACK,
			model2: BACK,
			provider3: "amazon",
			model4: BACK,
			provider5: "anthropic",
		});
		const outcome = await runPreflight(deps(), prompter, { defaults });
		expect(outcome.ok && outcome.result.modelId).toBe(defaults.modelId);
		expect(
			selections.map(({ id, initialValue }) => [id, initialValue]),
		).toEqual([
			["profile", "prod"],
			["provider", "anthropic"],
			["model", "anthropic.claude-sonnet-4-6"],
			["scope", defaults.modelId],
			["model", "anthropic.claude-sonnet-4-6"],
			["provider", "anthropic"],
			["model", undefined],
			["provider", "anthropic"],
			["model", "anthropic.claude-sonnet-4-6"],
			["scope", defaults.modelId],
		]);
	});

	test.each([
		"profile",
		"region",
		"provider",
		"model",
		"scope",
	])("cancellation at %s does not accept saved defaults", async (id) => {
		let accessChecked = false;
		const { prompter, asked } = scripted({ ...answers, [id]: null });
		expect(
			await runPreflight(
				deps({
					checkBedrockAccess: async () => {
						accessChecked = true;
						return true;
					},
				}),
				prompter,
				{ defaults },
			),
		).toEqual({ ok: false, cancelled: true, reason: "Cancelled." });
		expect(asked.at(-1)).toBe(id);
		expect(accessChecked).toBe(false);
	});
});
