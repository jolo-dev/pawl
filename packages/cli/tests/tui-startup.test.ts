import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BedrockModelGroup } from "../src/bedrock-models";
import {
	createProjectSettingsStore,
	type ProjectSettingsStore,
	type SettingsLoad,
} from "../src/settings";
import {
	BACK,
	type PreflightDeps,
	type PreflightPrompter,
	type PreflightSuccess,
	type SelectResult,
} from "../src/tui/preflight";
import { runStartup } from "../src/tui/startup";

const saved: PreflightSuccess = {
	profile: "prod",
	region: "ap-southeast-2",
	modelId: "us.anthropic.claude-sonnet-4-6",
	modelName: "Cached name",
};
const groups: BedrockModelGroup[] = [
	{
		baseId: "anthropic.claude-sonnet-4-6",
		provider: "anthropic",
		name: "Claude Sonnet 4.6",
		scopes: ["eu.anthropic.claude-sonnet-4-6", saved.modelId],
	},
	{
		baseId: "amazon.nova-2-lite-v1:0",
		provider: "amazon",
		name: "Nova 2 Lite",
		scopes: ["eu.amazon.nova-2-lite-v1:0"],
	},
];
const loaded: SettingsLoad = {
	kind: "saved",
	settings: { version: 1, ...saved },
};
const cancelled = { ok: false, cancelled: true, reason: "Cancelled." } as const;
const cancellationAnswers: SelectResult[] = [null, BACK];
const recoveryCancellationAnswers: SelectResult[] = ["cancel", null, BACK];
const refreshed = { ...saved, modelName: "Claude Sonnet 4.6" };

type Answer = readonly [id: string, value: SelectResult];
type SelectRequest = Parameters<PreflightPrompter["select"]>[0];
type TextRequest = Parameters<PreflightPrompter["text"]>[0];
const wizard: readonly Answer[] = [
	["profile", saved.profile],
	["region", saved.region],
	["provider", "anthropic"],
	["model", "anthropic.claude-sonnet-4-6"],
	["scope", saved.modelId],
];

function setup(
	initial: SettingsLoad,
	answers: readonly Answer[],
	overrides: Partial<PreflightDeps> = {},
	saveError?: unknown,
) {
	const events: string[] = [];
	const notices: string[] = [];
	const selections: SelectRequest[] = [];
	const texts: TextRequest[] = [];
	const saves: PreflightSuccess[] = [];
	let current = initial;
	let cursor = 0;
	const next = (id: string) => {
		events.push(`prompt:${id}`);
		const answer = answers[cursor++];
		expect(answer?.[0]).toBe(id);
		return answer?.[1] ?? null;
	};
	const prompter: PreflightPrompter = {
		async select(input) {
			selections.push(input);
			return next(input.id);
		},
		async text(input) {
			texts.push(input);
			const value = next(input.id);
			return typeof value === "string" ? value : null;
		},
		status(message) {
			events.push(`status:${message}`);
		},
		notice(message) {
			notices.push(message);
			events.push(`notice:${message}`);
		},
	};
	// Same fake AWS defaults as the preflight suite; every call is local and recorded.
	const deps: PreflightDeps = {
		async listProfiles() {
			events.push("aws:profiles");
			return overrides.listProfiles
				? overrides.listProfiles()
				: ["dev", "prod"];
		},
		async profileRegion(profile) {
			events.push(`aws:region:${profile}`);
			return overrides.profileRegion
				? overrides.profileRegion(profile)
				: "eu-central-1";
		},
		async isSso(profile) {
			events.push(`aws:sso:${profile}`);
			return overrides.isSso ? overrides.isSso(profile) : false;
		},
		async isSsoTokenValid(profile) {
			events.push(`aws:token:${profile}`);
			return overrides.isSsoTokenValid
				? overrides.isSsoTokenValid(profile)
				: true;
		},
		async ssoLogin(profile, report) {
			events.push(`aws:login:${profile}`);
			await overrides.ssoLogin?.(profile, report);
		},
		async checkCredentials(profile, region) {
			events.push(`aws:credentials:${profile}:${region}`);
			await overrides.checkCredentials?.(profile, region);
		},
		async listModelGroups(profile, region) {
			events.push(`aws:catalog:${profile}:${region}`);
			return overrides.listModelGroups
				? overrides.listModelGroups(profile, region)
				: groups;
		},
		async checkBedrockAccess(profile, region) {
			events.push(`aws:access:${profile}:${region}`);
			return overrides.checkBedrockAccess
				? overrides.checkBedrockAccess(profile, region)
				: true;
		},
	};
	const store: ProjectSettingsStore = {
		async load() {
			events.push("load");
			return current;
		},
		async save(selection) {
			events.push("save");
			saves.push(selection);
			if (saveError !== undefined) throw saveError;
			current = { kind: "saved", settings: { version: 1, ...selection } };
		},
	};
	return {
		events,
		notices,
		selections,
		texts,
		saves,
		current: () => current,
		async run(settingsStore = store) {
			const outcome = await runStartup({
				store: settingsStore,
				deps,
				prompter,
			});
			expect(cursor).toBe(answers.length);
			return outcome;
		},
	};
}

function expectRecovery(request: SelectRequest | undefined) {
	expect(request?.id).toBe("settings-recovery");
	expect(request?.options).toEqual([
		{ value: "change", label: "Change settings" },
		{ value: "cancel", label: "Cancel" },
	]);
}

describe("runStartup", () => {
	test("shows the entire saved overview before any AWS calls, defaults to Continue, validates and saves the live name", async () => {
		const flow = setup(loaded, [["saved-settings", "continue"]]);
		expect(await flow.run()).toEqual({ ok: true, result: refreshed });
		expect(flow.selections).toEqual([
			expect.objectContaining({
				id: "saved-settings",
				initialValue: "continue",
				options: [
					{ value: "continue", label: "Continue" },
					{ value: "change", label: "Change settings" },
				],
			}),
		]);
		const choice = flow.events.indexOf("prompt:saved-settings");
		expect(
			flow.events.slice(0, choice).some((event) => event.startsWith("aws:")),
		).toBe(false);
		for (const value of Object.values(saved)) {
			expect(flow.events.slice(0, choice).join("\n")).toContain(value);
		}
		expect(flow.events.filter((event) => event.startsWith("aws:"))).toEqual([
			"aws:profiles",
			"aws:sso:prod",
			"aws:credentials:prod:ap-southeast-2",
			"aws:catalog:prod:ap-southeast-2",
			"aws:access:prod:ap-southeast-2",
		]);
		expect(flow.texts).toEqual([]);
		expect(flow.saves).toEqual([refreshed]);
		expect(flow.events.at(-1)).toBe("save");
	});

	test.each(
		cancellationAnswers,
	)("overview cancellation (%s) does not call AWS or save", async (answer) => {
		const flow = setup(loaded, [["saved-settings", answer]]);
		expect(await flow.run()).toEqual(cancelled);
		expect(flow.events.some((event) => event.startsWith("aws:"))).toBe(false);
		expect(flow.saves).toEqual([]);
		expect(flow.current()).toEqual(loaded);
	});

	test("missing settings open the first-run wizard without defaults and save only after access validation", async () => {
		const flow = setup({ kind: "missing" }, wizard);
		expect(await flow.run()).toEqual({ ok: true, result: refreshed });
		expect(flow.selections.map(({ id }) => id)).toEqual([
			"profile",
			"provider",
			"model",
			"scope",
		]);
		for (const request of flow.selections)
			expect(request.initialValue).toBeUndefined();
		expect(flow.texts[0]?.initialValue).toBe("eu-central-1");
		expect(flow.saves).toEqual([refreshed]);
		expect(flow.events.slice(-2)).toEqual([
			"aws:access:prod:ap-southeast-2",
			"save",
		]);
	});

	test("Change settings uses saved defaults and saves a validated replacement", async () => {
		const flow = setup(loaded, [
			["saved-settings", "change"],
			...wizard.slice(0, 4),
			["scope", "eu.anthropic.claude-sonnet-4-6"],
		]);
		const result = { ...refreshed, modelId: "eu.anthropic.claude-sonnet-4-6" };
		expect(await flow.run()).toEqual({ ok: true, result });
		expect(
			flow.selections
				.slice(1)
				.map(({ id, initialValue }) => [id, initialValue]),
		).toEqual([
			["profile", "prod"],
			["provider", "anthropic"],
			["model", "anthropic.claude-sonnet-4-6"],
			["scope", saved.modelId],
		]);
		expect(flow.texts[0]?.initialValue).toBe(saved.region);
		expect(flow.saves).toEqual([result]);
	});

	test.each(
		recoveryCancellationAnswers,
	)("unusable settings require explicit recovery; cancellation (%s) preserves the file", async (answer) => {
		const unusable: SettingsLoad = {
			kind: "unusable",
			reason: "Invalid settings JSON.",
		};
		const flow = setup(unusable, [["settings-recovery", answer]]);
		expect(await flow.run()).toEqual(cancelled);
		expect(flow.notices).toEqual([unusable.reason]);
		expect(flow.events[1]).toBe(`notice:${unusable.reason}`);
		expectRecovery(flow.selections[0]);
		expect(flow.events.some((event) => event.startsWith("aws:"))).toBe(false);
		expect(flow.saves).toEqual([]);
		expect(flow.current()).toEqual(unusable);
	});

	test("explicit recovery from unusable settings runs a wizard without trusted defaults", async () => {
		const flow = setup({ kind: "unusable", reason: "Unsupported version." }, [
			["settings-recovery", "change"],
			...wizard,
		]);
		expect(await flow.run()).toEqual({ ok: true, result: refreshed });
		expect(flow.events.indexOf("prompt:settings-recovery")).toBeLessThan(
			flow.events.indexOf("aws:profiles"),
		);
		for (const request of flow.selections.slice(1))
			expect(request.initialValue).toBeUndefined();
		expect(flow.texts[0]?.initialValue).toBe("eu-central-1");
		expect(flow.saves).toEqual([refreshed]);
	});

	for (const initial of [
		loaded,
		{ kind: "missing" } as const,
		{ kind: "unusable", reason: "Corrupt." } as const,
	]) {
		test.each(
			wizard.map(([id]) => id),
		)(`cancelled ${initial.kind} wizard at %s never saves or recovers`, async (id) => {
			const stop = wizard.findIndex(([question]) => question === id);
			const prefix: Answer[] =
				initial.kind === "saved"
					? [["saved-settings", "change"]]
					: initial.kind === "unusable"
						? [["settings-recovery", "change"]]
						: [];
			const flow = setup(initial, [
				...prefix,
				...wizard.slice(0, stop),
				[id, null],
			]);
			expect(await flow.run()).toEqual(cancelled);
			expect(flow.saves).toEqual([]);
			expect(flow.current()).toEqual(initial);
		});
	}

	const failures: {
		name: string;
		overrides: Partial<PreflightDeps>;
		reason: string;
		steps: number;
	}[] = [
		{
			name: "profile read error",
			overrides: {
				listProfiles: async () => {
					throw new Error("config denied");
				},
			},
			reason: "config denied",
			steps: 0,
		},
		{
			name: "empty profiles",
			overrides: { listProfiles: async () => [] },
			reason: "No AWS profiles",
			steps: 0,
		},
		{
			name: "profile config error",
			overrides: {
				isSso: async () => {
					throw new Error("SSO config denied");
				},
			},
			reason: "SSO config denied",
			steps: 2,
		},
		{
			name: "login failure",
			overrides: {
				isSso: async () => true,
				isSsoTokenValid: async () => false,
				ssoLogin: async () => {
					throw new Error("login denied");
				},
			},
			reason: "login denied",
			steps: 2,
		},
		{
			name: "credential failure",
			overrides: {
				checkCredentials: async () => {
					throw new Error("expired credentials");
				},
			},
			reason: "expired credentials",
			steps: 2,
		},
		{
			name: "empty catalog",
			overrides: { listModelGroups: async () => [] },
			reason: "No text models",
			steps: 2,
		},
		{
			name: "catalog error",
			overrides: {
				listModelGroups: async () => {
					throw new Error("catalog denied");
				},
			},
			reason: "catalog denied",
			steps: 2,
		},
		{
			name: "access denied",
			overrides: { checkBedrockAccess: async () => false },
			reason: "No Bedrock access",
			steps: 5,
		},
		{
			name: "access error",
			overrides: {
				checkBedrockAccess: async () => {
					throw new Error("access unavailable");
				},
			},
			reason: "access unavailable",
			steps: 5,
		},
	];
	for (const mode of ["continue", "change"] as const) {
		test.each(
			failures,
		)(`${mode} $name explains the failure and offers recovery without saving`, async ({
			overrides,
			reason,
			steps,
		}) => {
			const flow = setup(
				loaded,
				[
					["saved-settings", mode],
					...(mode === "change" ? wizard.slice(0, steps) : []),
					["settings-recovery", "cancel"],
				],
				overrides,
			);
			expect(await flow.run()).toEqual(cancelled);
			expect(flow.notices.at(-1)).toContain(reason);
			expect(flow.events.at(-2)).toContain(`notice:${flow.notices.at(-1)}`);
			expectRecovery(flow.selections.at(-1));
			expect(flow.saves).toEqual([]);
			expect(flow.current()).toEqual(loaded);
		});
	}

	test.each(
		cancellationAnswers,
	)("validation recovery cancellation (%s) never retries", async (answer) => {
		const flow = setup(
			loaded,
			[
				["saved-settings", "continue"],
				["settings-recovery", answer],
			],
			{ listProfiles: async () => ["dev"] },
		);
		expect(await flow.run()).toEqual(cancelled);
		expect(flow.notices.at(-1)).toContain(
			'AWS profile "prod" is not available',
		);
		expect(flow.events.filter((event) => event.startsWith("aws:"))).toEqual([
			"aws:profiles",
		]);
		expect(flow.saves).toEqual([]);
	});

	test("stale exact scope requires recovery rather than substituting an available sibling scope", async () => {
		const flow = setup(
			loaded,
			[
				["saved-settings", "continue"],
				["settings-recovery", "cancel"],
			],
			{
				listModelGroups: async () =>
					groups.map((group) => ({
						...group,
						scopes: group.scopes.filter((scope) => scope !== saved.modelId),
					})),
			},
		);
		expect(await flow.run()).toEqual(cancelled);
		expect(flow.notices.at(-1)).toContain(
			`Model scope "${saved.modelId}" is not available`,
		);
		expect(flow.events.some((event) => event.startsWith("aws:access"))).toBe(
			false,
		);
		expect(flow.saves).toEqual([]);
		expect(flow.current()).toEqual(loaded);
	});

	test("profile-region lookup failure offers recovery without saving", async () => {
		const flow = setup(
			loaded,
			[
				["saved-settings", "change"],
				["profile", "prod"],
				["settings-recovery", "cancel"],
			],
			{
				profileRegion: async () => {
					throw new Error("region unreadable");
				},
			},
		);
		expect(await flow.run()).toEqual(cancelled);
		expect(flow.notices.at(-1)).toContain("region unreadable");
		expect(flow.saves).toEqual([]);
	});

	test("saved defaults survive failed Continue and failed edits until a replacement validates", async () => {
		let attempts = 0;
		const flow = setup(
			loaded,
			[
				["saved-settings", "continue"],
				["settings-recovery", "change"],
				["profile", "dev"],
				["region", "us-west-2"],
				["settings-recovery", "change"],
				...wizard,
			],
			{
				checkCredentials: async () => {
					if (++attempts < 3) throw new Error("temporarily unavailable");
				},
			},
		);
		expect(await flow.run()).toEqual({ ok: true, result: refreshed });
		expect(attempts).toBe(3);
		expect(
			flow.selections
				.filter(({ id }) => id === "profile")
				.map(({ initialValue }) => initialValue),
		).toEqual(["prod", "prod"]);
		expect(flow.texts.map(({ initialValue }) => initialValue)).toEqual([
			"eu-central-1",
			saved.region,
		]);
		expect(flow.saves).toEqual([refreshed]);
		expect(flow.events.filter((event) => event === "load")).toHaveLength(1);
	});

	test("first-run validation failure requires Change before retrying without defaults", async () => {
		let attempts = 0;
		const flow = setup(
			{ kind: "missing" },
			[...wizard.slice(0, 2), ["settings-recovery", "change"], ...wizard],
			{
				checkCredentials: async () => {
					if (++attempts === 1) throw new Error("retry explicitly");
				},
			},
		);
		expect(await flow.run()).toEqual({ ok: true, result: refreshed });
		expect(attempts).toBe(2);
		expect(flow.saves).toEqual([refreshed]);
		for (const request of flow.selections)
			expect(request.initialValue).toBeUndefined();
	});

	test.each([
		false,
		true,
	])("saved SSO validation forwards login notices and checks credentials (token valid=%s)", async (valid) => {
		const flow = setup(loaded, [["saved-settings", "continue"]], {
			isSso: async () => true,
			isSsoTokenValid: async () => valid,
			ssoLogin: async (_profile, report) =>
				report("https://example.invalid/login"),
		});
		expect(await flow.run()).toEqual({ ok: true, result: refreshed });
		expect(flow.events.filter((event) => event.startsWith("aws:"))).toEqual([
			"aws:profiles",
			"aws:sso:prod",
			"aws:token:prod",
			...(valid ? [] : ["aws:login:prod"]),
			"aws:credentials:prod:ap-southeast-2",
			"aws:catalog:prod:ap-southeast-2",
			"aws:access:prod:ap-southeast-2",
		]);
		if (!valid) expect(flow.notices).toContain("https://example.invalid/login");
	});

	for (const mode of ["continue", "change", "missing"] as const) {
		test.each([
			new Error("disk full"),
			"ignore denied",
		])(`${mode} save failure (%s) warns but returns validated success without restarting`, async (error) => {
			const initial: SettingsLoad =
				mode === "missing" ? { kind: "missing" } : loaded;
			const answers: Answer[] =
				mode === "missing"
					? [...wizard]
					: [["saved-settings", mode], ...(mode === "change" ? wizard : [])];
			const flow = setup(initial, answers, {}, error);
			expect(await flow.run()).toEqual({ ok: true, result: refreshed });
			expect(flow.saves).toEqual([refreshed]);
			expect(flow.current()).toEqual(initial);
			expect(flow.notices.at(-1)).toContain(
				"Could not save .pawl/settings.json:",
			);
			expect(flow.notices.at(-1)).toContain(
				error instanceof Error ? error.message : error,
			);
			expect(flow.notices.at(-1)).toContain(
				"Continuing with these settings for this session.",
			);
		});
	}

	test("the coordinator imports no runtime launcher or concrete AWS/persistence adapters", async () => {
		const source = await Bun.file(
			new URL("../src/tui/startup.ts", import.meta.url),
		).text();
		const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
			(match) => match[1],
		);
		expect(imports.sort()).toEqual([
			"../settings",
			"./preflight",
			"./preflight-validation",
		]);
	});
});

describe("runStartup project-file integration", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(
			directories
				.splice(0)
				.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	async function project(contents?: string) {
		const directory = await mkdtemp(join(tmpdir(), "pawl-startup-"));
		directories.push(directory);
		const settingsDirectory = join(directory, ".pawl");
		await mkdir(settingsDirectory);
		await writeFile(join(settingsDirectory, "plan.md"), "Keep this plan.\n");
		if (contents !== undefined)
			await writeFile(join(settingsDirectory, "settings.json"), contents);
		return {
			directory: settingsDirectory,
			file: join(settingsDirectory, "settings.json"),
			store: createProjectSettingsStore(directory),
		};
	}

	test("first run persists only validated fields, then Continue reloads and refreshes the live name", async () => {
		const fixture = await project();
		const first = setup({ kind: "missing" }, wizard);
		expect(await first.run(fixture.store)).toEqual({
			ok: true,
			result: refreshed,
		});
		expect(JSON.parse(await readFile(fixture.file, "utf8"))).toEqual({
			version: 1,
			...refreshed,
		});

		const liveName = "Updated live model name";
		const second = setup(
			{ kind: "missing" },
			[["saved-settings", "continue"]],
			{
				listModelGroups: async () =>
					groups.map((group) => ({ ...group, name: liveName })),
			},
		);
		expect(await second.run(fixture.store)).toEqual({
			ok: true,
			result: { ...refreshed, modelName: liveName },
		});
		expect(
			second.selections.map(({ id, initialValue }) => [id, initialValue]),
		).toEqual([["saved-settings", "continue"]]);
		expect(second.texts).toEqual([]);
		expect(second.events.filter((event) => event.startsWith("aws:"))).toEqual([
			"aws:profiles",
			"aws:sso:prod",
			"aws:credentials:prod:ap-southeast-2",
			"aws:catalog:prod:ap-southeast-2",
			"aws:access:prod:ap-southeast-2",
		]);
		expect(JSON.parse(await readFile(fixture.file, "utf8"))).toEqual({
			version: 1,
			...refreshed,
			modelName: liveName,
		});
		expect(
			await readFile(join(fixture.directory, ".gitignore"), "utf8"),
		).toContain("/settings.json\n/.settings-*.tmp\n");
		expect(await readFile(join(fixture.directory, "plan.md"), "utf8")).toBe(
			"Keep this plan.\n",
		);
		expect((await readdir(fixture.directory)).sort()).toEqual([
			".gitignore",
			"plan.md",
			"settings.json",
		]);
	});

	const unsuccessful: {
		name: string;
		answers: readonly Answer[];
		overrides: Partial<PreflightDeps>;
	}[] = [
		{
			name: "overview cancellation",
			answers: [["saved-settings", null]],
			overrides: {},
		},
		{
			name: "cancelled edit",
			answers: [
				["saved-settings", "change"],
				["profile", null],
			],
			overrides: {},
		},
		{
			name: "failed credentials followed by cancellation",
			answers: [
				["saved-settings", "continue"],
				["settings-recovery", "cancel"],
			],
			overrides: {
				checkCredentials: async () => {
					throw new Error("expired credentials");
				},
			},
		},
	];
	test.each(
		unsuccessful,
	)("$name never returns a launch result or changes the old file", async ({
		answers,
		overrides,
	}) => {
		const contents = `${JSON.stringify({ version: 1, ...saved }, null, 4)}\n`;
		const fixture = await project(contents);
		const flow = setup({ kind: "missing" }, answers, overrides);
		const outcome = await flow.run(fixture.store);
		expect(outcome).toEqual(cancelled);
		expect("result" in outcome).toBe(false);
		expect(await readFile(fixture.file, "utf8")).toBe(contents);
		expect((await readdir(fixture.directory)).sort()).toEqual([
			"plan.md",
			"settings.json",
		]);
	});

	test("production entrypoint uses the project store and startup coordinator before launching or rendering", async () => {
		const source = await Bun.file(
			new URL("../index.ts", import.meta.url),
		).text();
		expect(source).toContain(
			'import { createProjectSettingsStore } from "./src/settings";',
		);
		expect(source).toContain('import { runStartup } from "./src/tui/startup";');
		expect(source).not.toContain("runPreflight");
		expect(source).toMatch(
			/const outcome = await runStartup\(\{\s*store: createProjectSettingsStore\(projectDir\),\s*deps: defaultPreflightDeps\(\),\s*prompter: createClackPrompter\(\),\s*\}\);/,
		);
		const startup = source.indexOf("const outcome = await runStartup");
		const guard = source.indexOf("if (!outcome.ok)");
		const launch = source.indexOf("const server = await startPawlServer");
		const renderer = source.indexOf("const renderer = await createCliRenderer");
		expect(startup).toBeLessThan(guard);
		expect(guard).toBeLessThan(launch);
		expect(launch).toBeLessThan(renderer);
		expect(source.slice(guard, launch)).toContain(
			"process.exit(outcome.cancelled ? 0 : 1)",
		);
	});
});
