import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	createExecutionContext,
	type ExecutionContextDependencies,
} from "../src/pi-runtime/execution-context";
import {
	type ControlledExecResult,
	captureMarker,
	createControlledExec,
} from "../src/pi-runtime/host-exec";
import {
	createRuntimePolicy,
	HOST_GRACEFUL_CLEANUP_MS,
	PolicyExhaustedError,
} from "../src/pi-runtime/policy";

/**
 * Task 7 controlled subprocesses: `createControlledExec(context, policy)` is
 * an internal executor, not a model-invoked shell. It binds cwd/environment to
 * the Task 3 execution context, accepts the shared signal and deadline on
 * every call, uses owned process groups with the Task 6 graceful/forced
 * deadlines and bounded reaping, fails closed on unsupported platforms, and
 * removes credential temporary files only after process settlement.
 */

const ACCOUNT = "123456789012";
const REGION = "eu-central-1";
const NOW = 1_800_000_000_000;
const CAP = 64 * 1024;

const FIXTURE = join(import.meta.dir, "fixtures/host-exec-fixture.cjs");

const directories: string[] = [];
const scratch = () => {
	const path = mkdtempSync(join(tmpdir(), "pawl-host-exec-test-"));
	directories.push(path);
	return path;
};
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

const credentials = (key = "selected-key", expires = NOW + 3_600_000) => ({
	accessKeyId: key,
	secretAccessKey: "selected-secret",
	sessionToken: "selected-token",
	expiration: new Date(expires),
});
const caller = {
	Account: ACCOUNT,
	Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/SelectedRole/session-1`,
};

/** Minimal Task 3 execution-context fixture (same seam as its own tests). */
function contextFixture() {
	let current = credentials();
	const dependencies: ExecutionContextDependencies = {
		credentialsFromIni: () => async () => current,
		identityClient: (config) => {
			expect(config.region).toBe(REGION);
			return {
				async identify(signal) {
					signal.throwIfAborted();
					return caller;
				},
				destroy() {},
			};
		},
		now: () => NOW,
	};
	return {
		dependencies,
		setCredentials(value: typeof current) {
			current = value;
		},
		create: async () =>
			createExecutionContext(
				{ projectDir: scratch(), profile: "selected", region: REGION },
				dependencies,
			),
	};
}

const policy = (options: Parameters<typeof createRuntimePolicy>[0] = {}) =>
	createRuntimePolicy(options);

/** Probe a fixture-owned PID without killing it (signal 0 only). */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}
async function assertNotAlive(pid: number | undefined, what: string) {
	expect(
		typeof pid === "number" && pid > 0,
		`${what} pid is fixture-owned`,
	).toBe(true);
	const deadline = Date.now() + 5_000;
	while (isAlive(pid as number)) {
		if (Date.now() > deadline)
			throw new Error(`${what} (pid ${pid}) is still alive`);
		await Bun.sleep(50);
	}
}

/** Wait for a fixture-owned record file written by the spawned child. */
interface FixtureRecord {
	pid: number;
	grandchild?: number;
	awsConfigFile?: string;
}
async function readRecord(path: string): Promise<FixtureRecord> {
	const deadline = Date.now() + 5_000;
	for (;;) {
		try {
			return JSON.parse(readFileSync(path, "utf8")) as FixtureRecord;
		} catch {
			if (Date.now() > deadline)
				throw new Error(`fixture record never appeared: ${path}`);
			await Bun.sleep(25);
		}
	}
}

const fixtureArgs = (mode: string, ...rest: string[]) => [
	FIXTURE,
	mode,
	...rest,
];

/** Observes uncaught exceptions during a bounded window instead of crashing. */
function captureUncaught() {
	const errors: unknown[] = [];
	const handler = (error: unknown) => {
		errors.push(error);
	};
	process.on("uncaughtException", handler);
	return {
		errors,
		detach: () => {
			process.off("uncaughtException", handler);
		},
	};
}

const failAllKills =
	(): ((pid: number, signal: NodeJS.Signals) => void) => () => {
		throw Object.assign(new Error("operation not permitted"), {
			code: "EPERM",
		});
	};

const pollutedAmbient = () => ({
	...process.env,
	AWS_ACCESS_KEY_ID: "ambient-key",
	AWS_SECRET_ACCESS_KEY: "ambient-secret",
	AWS_SESSION_TOKEN: "ambient-token",
	AWS_PROFILE: "ambient-profile",
	AWS_DEFAULT_PROFILE: "ambient-profile",
	AWS_REGION: "us-ambient-1",
	AWS_DEFAULT_REGION: "us-ambient-1",
	AWS_CONFIG_FILE: "/ambient/config",
	AWS_SHARED_CREDENTIALS_FILE: "/ambient/credentials",
	AWS_WEB_IDENTITY_TOKEN_FILE: "/ambient/token",
	AWS_ROLE_ARN: `arn:aws:iam::${ACCOUNT}:role/ambient`,
	AWS_EC2_METADATA_DISABLED: "false",
	CDK_DEFAULT_ACCOUNT: "999999999999",
	CDK_DEFAULT_REGION: "us-ambient-1",
});

describe("createControlledExec", () => {
	test("returns captured stdout and stderr for a successful fixture command", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const result = await exec.run({
			command: process.execPath,
			args: fixtureArgs("echo", "pawl-stdout"),
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("pawl-stdout");
		expect(result.stderr).toBe("");
		expect(result.stdoutTruncated).toBe(false);
		expect(result.stderrTruncated).toBe(false);
	});

	test("runs in the selected project directory", async () => {
		const context = await contextFixture().create();
		const exec = createControlledExec(context, policy());
		const result = await exec.run({
			command: process.execPath,
			args: fixtureArgs("cwd"),
		});
		expect(result.stdout).toBe(context.projectDir);
	});

	test("rejects a nonzero exit with the child's stderr", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const error = await exec
			.run({
				command: process.execPath,
				args: fixtureArgs("fail", "boom-message", "7"),
			})
			.then(
				() => undefined,
				(value: unknown) => value,
			);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("7");
		expect((error as Error).message).toContain("boom-message");
	});

	test("caps each stream at 64 KiB with explicit truncation markers", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const result = await exec.run({
			command: process.execPath,
			args: fixtureArgs("flood"),
		});
		expect(result.stdoutTruncated).toBe(true);
		expect(result.stderrTruncated).toBe(true);
		expect(result.stdout.endsWith(captureMarker("stdout", 71_680))).toBe(true);
		expect(result.stderr.endsWith(captureMarker("stderr", 71_680))).toBe(true);
		expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(
			CAP + Buffer.byteLength(captureMarker("stdout", 71_680), "utf8"),
		);
		expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(
			CAP + Buffer.byteLength(captureMarker("stderr", 71_680), "utf8"),
		);
	});

	test("rejects before spawning when the signal is already aborted", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const controller = new AbortController();
		const record = join(scratch(), "record.json");
		controller.abort(new Error("cancelled before spawn"));
		await expect(
			exec.run({
				command: process.execPath,
				args: fixtureArgs("record", record),
				signal: controller.signal,
			}),
		).rejects.toThrow("cancelled before spawn");
		expect(existsSync(record)).toBe(false);
	});

	test("terminates a default-handling child on request cancellation", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const controller = new AbortController();
		const record = join(scratch(), "record.json");
		const pending = exec
			.run({
				command: process.execPath,
				args: fixtureArgs("hold", record),
				signal: controller.signal,
			})
			.catch((value: unknown) => value);
		await readRecord(record);
		controller.abort(new Error("fixture cancellation"));
		const outcome = await pending;
		expect((outcome as Error).message).toBe("fixture cancellation");
		await assertNotAlive(
			(await readRecord(record)).pid,
			"gracefully terminated child",
		);
	});

	test("forces SIGTERM-resistant child and grandchild to settle through the owned process group", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const record = join(scratch(), "record.json");
		const error = await exec
			.run({
				command: process.execPath,
				args: fixtureArgs("trap", record),
				timeoutMs: 300,
			})
			.then(
				() => undefined,
				(value: unknown) => value,
			);
		expect((error as Error).message).toContain("timed out");
		const { pid, grandchild } = await readRecord(record);
		await assertNotAlive(pid, "SIGTERM-resistant child");
		await assertNotAlive(grandchild, "SIGTERM-resistant grandchild");
	}, 15_000);

	test("kills a resistant grandchild when the graceful parent exits during the graceful window", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const controller = new AbortController();
		const record = join(scratch(), "record.json");
		const pending = exec
			.run({
				command: process.execPath,
				args: fixtureArgs("spawn-resistant", record),
				signal: controller.signal,
			})
			.catch((value: unknown) => value);
		await readRecord(record);
		controller.abort(new Error("fixture cancellation"));
		const outcome = await pending;
		expect((outcome as Error).message).toBe("fixture cancellation");
		const { pid, grandchild } = await readRecord(record);
		await assertNotAlive(pid, "SIGTERM-graceful parent");
		await assertNotAlive(
			grandchild,
			"resistant grandchild after the parent exited",
		);
	}, 15_000);

	test("a failing graceful group signal settles fail-closed instead of crashing the host", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
			{ signalProcess: failAllKills() },
		);
		const controller = new AbortController();
		const record = join(scratch(), "record.json");
		const uncaught = captureUncaught();
		try {
			const pending = exec
				.run({
					command: process.execPath,
					args: fixtureArgs("hold-briefly", record),
					signal: controller.signal,
				})
				.catch((value: unknown) => value);
			await readRecord(record);
			controller.abort(new Error("fixture cancellation"));
			const outcome = await pending;
			expect((outcome as Error).message).toBe("fixture cancellation");
			expect(uncaught.errors).toEqual([]);
		} finally {
			uncaught.detach();
		}
	}, 15_000);

	test("a failing forced group signal settles fail-closed instead of crashing the host", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
			{
				signalProcess: (pid, signal) => {
					if (signal === "SIGKILL")
						throw Object.assign(new Error("operation not permitted"), {
							code: "EPERM",
						});
					process.kill(pid, signal);
				},
			},
		);
		const controller = new AbortController();
		const record = join(scratch(), "record.json");
		const uncaught = captureUncaught();
		try {
			const pending = exec
				.run({
					command: process.execPath,
					args: fixtureArgs("hold", record),
					signal: controller.signal,
				})
				.catch((value: unknown) => value);
			await readRecord(record);
			controller.abort(new Error("fixture cancellation"));
			const outcome = await pending;
			expect((outcome as Error).message).toBe("fixture cancellation");
			// Keep the injected-failure window open across the whole graceful
			// window so the forced-step timer callback runs while kills fail.
			await Bun.sleep(HOST_GRACEFUL_CLEANUP_MS + 300);
			expect(uncaught.errors).toEqual([]);
		} finally {
			uncaught.detach();
		}
	}, 15_000);

	test("attaches the settled outcome when a cancelled child had already completed", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const controller = new AbortController();
		const record = join(scratch(), "record.json");
		const pending = exec
			.run({
				command: process.execPath,
				args: fixtureArgs("trap-exit", record),
				signal: controller.signal,
			})
			.catch((value: unknown) => value);
		await readRecord(record);
		controller.abort(new Error("fixture cancellation"));
		const outcome = await pending;
		expect((outcome as Error).message).toBe("fixture cancellation");
		// A completed side effect must never be reported as a bare cancel.
		const settled = (outcome as { settledOutcome?: ControlledExecResult })
			.settledOutcome;
		expect(settled?.exitCode).toBe(0);
		expect(settled?.stdout).toBe("");
		expect(settled?.stderr).toBe("");
		expect(settled?.stdoutTruncated).toBe(false);
		const { pid } = await readRecord(record);
		await assertNotAlive(pid, "trap-exit child");
	}, 15_000);

	test("rejects with the stored policy rejection when the shared budget exhausts mid-run", async () => {
		const context = await contextFixture().create();
		const testPolicy = policy({ toolExecutions: 1 });
		expect(testPolicy.checkBeforeTool("seed").allowed).toBe(true);
		const exec = createControlledExec(context, testPolicy);
		const record = join(scratch(), "record.json");
		const pending = exec
			.run({
				command: process.execPath,
				args: fixtureArgs("hold", record),
			})
			.catch((value: unknown) => value);
		await readRecord(record);
		expect(testPolicy.checkBeforeTool("exhaust").allowed).toBe(false);
		const outcome = await pending;
		expect(outcome).toBeInstanceOf(PolicyExhaustedError);
		expect((outcome as PolicyExhaustedError).code).toBe(
			"tool_execution_budget",
		);
		await assertNotAlive(
			(await readRecord(record)).pid,
			"child after shared cancellation",
		);
	}, 15_000);

	test("caps the request timeout with the shared run deadline", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy({ runDeadlineMs: 700 }),
		);
		const record = join(scratch(), "record.json");
		const started = Date.now();
		const error = await exec
			.run({
				command: process.execPath,
				args: fixtureArgs("hold", record),
				timeoutMs: 60_000,
			})
			.then(
				() => undefined,
				(value: unknown) => value,
			);
		expect(error).toBeInstanceOf(Error);
		await assertNotAlive(
			(await readRecord(record)).pid,
			"child capped by the run deadline",
		);
		expect(Date.now() - started).toBeLessThan(10_000);
	}, 15_000);

	test("refuses to start when the run deadline leaves no host-command budget", async () => {
		let nowMs = 0;
		const timers: (() => void)[] = [];
		const exec = createControlledExec(
			await contextFixture().create(),
			policy({
				runDeadlineMs: 1_000,
				dependencies: {
					now: () => nowMs,
					scheduleTimeout: (handler) => {
						timers.push(handler);
						return () => {};
					},
				},
			}),
		);
		const record = join(scratch(), "record.json");
		nowMs = 1_000;
		for (const timer of [...timers]) timer();
		const error = await exec
			.run({
				command: process.execPath,
				args: fixtureArgs("record", record),
			})
			.then(
				() => undefined,
				(value: unknown) => value,
			);
		expect(error).toBeInstanceOf(PolicyExhaustedError);
		expect((error as PolicyExhaustedError).code).toBe("run_deadline");
		expect(existsSync(record)).toBe(false);
	});

	test("rejects profile/role flags through the Task 3 boundary", async () => {
		const exec = createControlledExec(
			await contextFixture().create(),
			policy(),
		);
		const record = join(scratch(), "record.json");
		await expect(
			exec.run({
				command: process.execPath,
				args: [...fixtureArgs("record", record), "--profile", "other"],
			}),
		).rejects.toThrow(/profile/i);
		expect(existsSync(record)).toBe(false);
	});

	test("neutralizes inherited AWS conflicts and supplies the checked snapshot environment", async () => {
		const context = await contextFixture().create();
		const exec = createControlledExec(context, policy());
		const result = await exec.run({
			command: process.execPath,
			args: fixtureArgs("env"),
			env: pollutedAmbient(),
		});
		const childEnv = JSON.parse(result.stdout) as Record<string, string>;
		expect(childEnv.AWS_ACCESS_KEY_ID).toBe("selected-key");
		expect(childEnv.AWS_SECRET_ACCESS_KEY).toBe("selected-secret");
		expect(childEnv.AWS_SESSION_TOKEN).toBe("selected-token");
		expect(childEnv.AWS_PROFILE).toBe("default");
		expect(childEnv.AWS_REGION).toBe(REGION);
		expect(childEnv.AWS_DEFAULT_REGION).toBe(REGION);
		expect(childEnv.AWS_EC2_METADATA_DISABLED).toBe("true");
		expect(childEnv.CDK_DEFAULT_ACCOUNT).toBe(ACCOUNT);
		expect(childEnv.CDK_DEFAULT_REGION).toBe(REGION);
		expect(Object.values(childEnv)).not.toContain("ambient-key");
		expect(Object.values(childEnv)).not.toContain("ambient-secret");
		expect(childEnv.AWS_CONFIG_FILE).not.toBe("/ambient/config");
		expect(childEnv.AWS_SHARED_CREDENTIALS_FILE).not.toBe(
			"/ambient/credentials",
		);
		expect(childEnv.AWS_ROLE_ARN).toBeUndefined();
		expect(childEnv.AWS_WEB_IDENTITY_TOKEN_FILE).toBeUndefined();
		expect(childEnv.AWS_CONFIG_FILE?.startsWith(context.projectDir)).toBe(
			false,
		);
	});

	test("refuses when credential lifetime cannot cover the child timeout", async () => {
		const fixture = contextFixture();
		const context = await fixture.create();
		fixture.setCredentials(credentials("short", NOW + 60_999));
		await context.refreshCredentials();
		const record = join(scratch(), "record.json");
		const exec = createControlledExec(context, policy());
		await expect(
			exec.run({
				command: process.execPath,
				args: fixtureArgs("record", record),
			}),
		).rejects.toThrow(/lifetime/i);
		expect(existsSync(record)).toBe(false);
	});

	test("removes credential temporary files after settlement on success and failure", async () => {
		const context = await contextFixture().create();
		const exec = createControlledExec(context, policy());
		for (const exitCode of [0, 7]) {
			const record = join(scratch(), `record-${exitCode}.json`);
			await exec
				.run({
					command: process.execPath,
					args: fixtureArgs("record", record, String(exitCode)),
				})
				.then(
					() => undefined,
					() => undefined,
				);
			const { awsConfigFile } = await readRecord(record);
			expect(awsConfigFile).toBeTruthy();
			expect(existsSync(dirname(awsConfigFile as string))).toBe(false);
		}
	});

	test("rejects a missing executable without leaking credential paths", async () => {
		const context = await contextFixture().create();
		const exec = createControlledExec(context, policy());
		await expect(
			exec.run({
				command: "definitely-missing-pawl-fixture-binary",
				args: [],
			}),
		).rejects.toThrow(/ENOENT|spawn|not found/i);
	});

	test("propagates cleanup failures as leftover paths without secret contents", async () => {
		const context = await contextFixture().create();
		const exec = createControlledExec(context, policy());
		const record = join(scratch(), "record.json");
		// The child records its credential directory, makes it unwritable and
		// exits, so the executor's rmSync cleanup must fail closed.
		const trapScript = [
			`const fs = require("node:fs");`,
			`const path = require("node:path");`,
			`fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, awsConfigFile: process.env.AWS_CONFIG_FILE }));`,
			`fs.chmodSync(path.dirname(process.env.AWS_CONFIG_FILE), 0o500);`,
		].join(" ");
		const error = await exec
			.run({
				command: process.execPath,
				args: ["-e", trapScript, "--", record],
			})
			.then(
				() => undefined,
				(value: unknown) => value,
			);
		// Restore permissions so afterEach cleanup can remove the directory,
		// then remove the leftover credential directory itself.
		const { awsConfigFile } = await readRecord(record);
		if (awsConfigFile) {
			chmodSync(dirname(awsConfigFile), 0o700);
			rmSync(dirname(awsConfigFile), { recursive: true, force: true });
		}
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toContain("pawl-checked-aws-");
		expect(message).not.toContain("selected-secret");
		expect(message).not.toContain("selected-key");
	});

	test("fails closed on unsupported platforms", async () => {
		const context = await contextFixture().create();
		expect(() =>
			createControlledExec(context, policy(), { platform: "win32" }),
		).toThrow(/win32|unsupported/i);
	});
});
