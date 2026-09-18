import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ProofConfig,
	ProofRefusedError,
	parseProofArgs,
	runProof,
} from "../scripts/verify-pi-runtime-proof";
import { FIXTURE_MODEL } from "./fixtures/pi-runtime-stream";

/**
 * Task 14: the explicit proof runner's CLI contract and offline execution.
 *
 * Parsing is fully separated from execution, so these tests never log in,
 * never resolve AWS credentials and never call a provider. The offline run
 * exercises the real Task 10 conversation over the Task 13 deterministic
 * fixtures against an explicitly selected temporary project, and proves the
 * resume contract (history is loaded, nothing runs until a new prompt).
 */

const cleanups: string[] = [];

async function emptyProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pawl-proof-runner-"));
	cleanups.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of cleanups.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

/** Asserts the offline evidence shape for a fresh (non-resumed) headless run. */
async function assertOfflineEvidence(
	evidence: Awaited<ReturnType<typeof runProof>>,
	projectDir: string,
): Promise<void> {
	expect(evidence.mode).toBe("offline");
	expect(evidence.identity).toBeUndefined();
	expect(evidence.sessions).toHaveLength(1);
	const session = evidence.sessions[0];
	if (!session) throw new Error("missing session evidence");
	expect(session.resumed).toBe(false);
	expect(session.modelId).toBe(FIXTURE_MODEL.id);
	expect(session.userMessages).toBe(1);
	expect(session.modelRequests).toBe(2);
	expect(session.toolExecutions).toBe(1);
	expect(session.assistantReplies).toBe(2);
	expect(session.terminalOutcomes).toEqual(["completed"]);
	for (const check of session.checks) {
		expect(`${check.name}: ${check.passed}`).toBe(`${check.name}: true`);
	}
	const sessionStat = await stat(session.path);
	expect(sessionStat.isFile()).toBe(true);
	expect(
		session.path.startsWith(
			join(realpathSync(projectDir), ".pawl", "sessions"),
		),
	).toBe(true);
}

const LIVE_ENV = { PAWL_PI_PROOF_LIVE: "1" };

const fullLiveArgs = [
	"--project-dir",
	"/tmp/pawl-proof-live",
	"--live",
	"--confirm-live-bedrock",
	"--profile",
	"jolo",
	"--region",
	"eu-central-1",
	"--model-id",
	"eu.amazon.nova-2-lite-v1:0",
	"--second-model-id",
	"eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
];

function parseError(argv: string[], env: Record<string, string> = {}): string {
	const parsed = parseProofArgs(argv, env);
	expect(parsed.ok).toBe(false);
	if (parsed.ok) throw new Error("expected parse failure");
	return parsed.error;
}

describe("proof runner argument parsing", () => {
	test("--project-dir is always required", () => {
		expect(parseError([])).toMatch(/--project-dir/);
		expect(parseError(["--offline"])).toMatch(/--project-dir/);
	});

	test("offline is the default mode without any mode flag", () => {
		const parsed = parseProofArgs(["--project-dir", "/tmp/proof"]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.config.mode).toBe("offline");
		expect(parsed.config.tui).toBe(false);
		expect(parsed.config.resumeSessionId).toBeUndefined();
		expect(parsed.config.profile).toBeUndefined();
		expect(parsed.config.region).toBeUndefined();
	});

	test("--offline is accepted explicitly", () => {
		const parsed = parseProofArgs(["--project-dir", "/tmp/proof", "--offline"]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.config.mode).toBe("offline");
	});

	test("--offline and --live are mutually exclusive", () => {
		expect(
			parseError(["--project-dir", "/tmp/proof", "--offline", "--live"]),
		).toMatch(/mutually exclusive|--live/);
	});

	test("live mode is refused without PAWL_PI_PROOF_LIVE=1", () => {
		const error = parseError(["--project-dir", "/tmp/proof", "--live"]);
		expect(error).toMatch(/PAWL_PI_PROOF_LIVE=1/);
	});

	test("live mode is refused without --confirm-live-bedrock even with the env gate", () => {
		const error = parseError(
			["--project-dir", "/tmp/proof", "--live"],
			LIVE_ENV,
		);
		expect(error).toMatch(/--confirm-live-bedrock/);
	});

	test("live mode requires profile, region, model id and second model id", () => {
		const error = parseError(
			[
				"--project-dir",
				"/tmp/proof",
				"--live",
				"--confirm-live-bedrock",
				"--profile",
				"jolo",
			],
			LIVE_ENV,
		);
		for (const missing of ["--region", "--model-id", "--second-model-id"]) {
			expect(error).toContain(missing);
		}
	});

	test("a complete live configuration parses", () => {
		const parsed = parseProofArgs(fullLiveArgs, LIVE_ENV);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.config.mode).toBe("live");
		expect(parsed.config.profile).toBe("jolo");
		expect(parsed.config.region).toBe("eu-central-1");
		expect(parsed.config.modelId).toBe("eu.amazon.nova-2-lite-v1:0");
		expect(parsed.config.secondModelId).toBe(
			"eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
		);
	});

	test("--confirm-live-bedrock without --live is a conflict", () => {
		expect(
			parseError(["--project-dir", "/tmp/proof", "--confirm-live-bedrock"]),
		).toMatch(/--confirm-live-bedrock/);
	});

	test("AWS selections are refused in offline mode: offline never resolves credentials", () => {
		const error = parseError([
			"--project-dir",
			"/tmp/proof",
			"--offline",
			"--profile",
			"jolo",
		]);
		expect(error).toMatch(/offline/);
		expect(
			parseError([
				"--project-dir",
				"/tmp/proof",
				"--model-id",
				"eu.amazon.nova-2-lite-v1:0",
			]),
		).toMatch(/offline/);
	});

	test("the second live model must differ from the first", () => {
		const error = parseError(
			[
				"--project-dir",
				"/tmp/proof",
				"--live",
				"--confirm-live-bedrock",
				"--profile",
				"jolo",
				"--region",
				"eu-central-1",
				"--model-id",
				"eu.amazon.nova-2-lite-v1:0",
				"--second-model-id",
				"eu.amazon.nova-2-lite-v1:0",
			],
			LIVE_ENV,
		);
		expect(error).toMatch(/second model|different/);
	});

	test("an invalid live region is refused before anything runs", () => {
		const error = parseError(
			[
				"--project-dir",
				"/tmp/proof",
				"--live",
				"--confirm-live-bedrock",
				"--profile",
				"jolo",
				"--region",
				"not-a-region",
				"--model-id",
				"eu.amazon.nova-2-lite-v1:0",
				"--second-model-id",
				"eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
			],
			LIVE_ENV,
		);
		expect(error).toMatch(/--region/);
	});

	test("--tui enables the terminal view and --resume-session records the session id", () => {
		const parsed = parseProofArgs([
			"--project-dir",
			"/tmp/proof",
			"--tui",
			"--resume-session",
			"proof_1",
		]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.config.tui).toBe(true);
		expect(parsed.config.resumeSessionId).toBe("proof_1");
	});

	test("unknown arguments and missing flag values are refused", () => {
		expect(parseError(["--project-dir", "/tmp/proof", "--deploy"])).toMatch(
			/Unknown argument/,
		);
		expect(parseError(["--project-dir"])).toMatch(/--project-dir/);
		expect(
			parseError(["--project-dir", "/tmp/proof", "--resume-session"]),
		).toMatch(/--resume-session/);
	});
});

describe("proof runner module import", () => {
	test("exports parsing and execution without import side effects", async () => {
		expect(typeof parseProofArgs).toBe("function");
		expect(typeof runProof).toBe("function");
		// The script runs only when executed directly; importing it (as these
		// tests and reviewers do) must not start a proof, print or exit.
		const source = await readFile(
			new URL("../scripts/verify-pi-runtime-proof.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("if (import.meta.main)");
	});

	test("the --tui path wires the native OpenTUI renderer through the Task 13 view", async () => {
		const source = await readFile(
			new URL("../scripts/verify-pi-runtime-proof.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("createCliRenderer");
		expect(source).toContain("createTuiView");
		expect(source).toContain("createPawlApp");
	});
});

describe("offline proof run", () => {
	test("runs the fixture conversation offline without resolving AWS credentials", async () => {
		const projectDir = await emptyProject();
		// Garbage ambient AWS configuration must be irrelevant to offline mode.
		const previousProfile = process.env.AWS_PROFILE;
		const previousRegion = process.env.AWS_DEFAULT_REGION;
		process.env.AWS_PROFILE = "pawl-proof-nonexistent-profile";
		process.env.AWS_DEFAULT_REGION = "us-invalid-1";
		try {
			const evidence = await runProof({
				mode: "offline",
				projectDir,
				tui: false,
			});
			assertOfflineEvidence(evidence, projectDir);
		} finally {
			if (previousProfile === undefined) delete process.env.AWS_PROFILE;
			else process.env.AWS_PROFILE = previousProfile;
			if (previousRegion === undefined) delete process.env.AWS_DEFAULT_REGION;
			else process.env.AWS_DEFAULT_REGION = previousRegion;
		}
	});

	test("a resume invocation loads history without an automatic opening prompt", async () => {
		const projectDir = await emptyProject();
		const first = await runProof({ mode: "offline", projectDir, tui: false });
		const prior = first.sessions[0];
		if (!prior) throw new Error("missing first session");

		const second = await runProof({
			mode: "offline",
			projectDir,
			tui: false,
			resumeSessionId: prior.sessionId,
		});
		expect(second.sessions).toHaveLength(1);
		const resumed = second.sessions[0];
		if (!resumed) throw new Error("missing resumed session");
		expect(resumed.resumed).toBe(true);
		expect(resumed.sessionId).toBe(prior.sessionId);
		expect(resumed.path).toBe(prior.path);
		// Nothing runs until a new prompt: no provider request, no tool, no run.
		expect(resumed.userMessages).toBe(0);
		expect(resumed.modelRequests).toBe(0);
		expect(resumed.toolExecutions).toBe(0);
		expect(resumed.terminalOutcomes).toEqual([]);
		expect(
			resumed.checks.some((check) => check.name === "history_recovered"),
		).toBe(true);
	});

	test("refuses a non-empty project directory for a new session", async () => {
		const projectDir = await emptyProject();
		await writeFile(join(projectDir, "user-file.txt"), "not a proof project");
		try {
			await runProof({ mode: "offline", projectDir, tui: false });
			throw new Error("expected the offline proof to refuse the directory");
		} catch (error) {
			expect(error).toBeInstanceOf(ProofRefusedError);
			expect((error as Error).message).toMatch(/temporary project/);
		}
	});

	test("refuses resuming a session that does not exist", async () => {
		const projectDir = await emptyProject();
		try {
			await runProof({
				mode: "offline",
				projectDir,
				tui: false,
				resumeSessionId: "proof_missing",
			});
			throw new Error("expected the resume to refuse the unknown session");
		} catch (error) {
			expect(error).toBeInstanceOf(ProofRefusedError);
			expect((error as Error).message).toMatch(/proof_missing/);
		}
	});

	test("refuses --project-dir paths that are not directories", async () => {
		const projectDir = await emptyProject();
		const filePath = join(projectDir, "file");
		await writeFile(filePath, "x");
		try {
			await runProof({ mode: "offline", projectDir: filePath, tui: false });
			throw new Error("expected a refusal for a non-directory project");
		} catch (error) {
			expect(error).toBeInstanceOf(ProofRefusedError);
			expect((error as Error).message).toMatch(/directory/);
		}
	});
});

describe("live execution gate", () => {
	test("runProof refuses a directly constructed live config without the env gate", async () => {
		const previous = process.env.PAWL_PI_PROOF_LIVE;
		delete process.env.PAWL_PI_PROOF_LIVE;
		try {
			const config: ProofConfig = {
				mode: "live",
				projectDir: await emptyProject(),
				tui: false,
				profile: "jolo",
				region: "eu-central-1",
				modelId: "eu.amazon.nova-2-lite-v1:0",
				secondModelId: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
			};
			await runProof(config);
			throw new Error("expected live execution to be refused");
		} catch (error) {
			expect(error).toBeInstanceOf(ProofRefusedError);
			expect((error as Error).message).toMatch(/PAWL_PI_PROOF_LIVE=1/);
		} finally {
			if (previous !== undefined) process.env.PAWL_PI_PROOF_LIVE = previous;
		}
	});
});
