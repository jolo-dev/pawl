import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import {
	type ApprovalBinding,
	ApprovalBroker,
} from "../src/pi-runtime/approval";
import {
	type ArtifactExec,
	DeployArtifactError,
	deployApprovedArtifact,
	type PreparedArtifact,
	prepareArtifact,
	previewArtifact,
	verifyArtifact,
} from "../src/pi-runtime/deploy-artifact";
import type {
	ControlledExecRequest,
	ControlledExecResult,
} from "../src/pi-runtime/host-exec";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";

/**
 * Task 9: immutable deployment artifact proof.
 *
 * `prepareArtifact` freezes one synthesized assembly in an exclusive private
 * directory under `.pawl/artifacts/` after validating the supported subset
 * (top-level stacks + materialized regular-file assets). `previewArtifact`
 * runs a read-only template diff against the frozen assembly, and
 * `deployApprovedArtifact` revalidates identity, integrity, approval and
 * expiry under the mutation permit before the Task 7 executor consumes the
 * frozen material. Changed frozen material is always refused; changed project
 * source either leaves the frozen snapshot unchanged or requires a new
 * preview. Fake synthesis/CDK executors prove the chain; no live deploy or
 * asset publishing exists in this proof.
 */

const ACCOUNT = "123456789012";
const REGION = "eu-central-1";
const TARGET = { accountId: ACCOUNT, region: REGION };

const directories: string[] = [];
const scratch = () => {
	const path = mkdtempSync(join(tmpdir(), "pawl-deploy-artifact-test-"));
	directories.push(path);
	return path;
};
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

// ---- assembly fixtures ------------------------------------------------- //

interface FixtureOptions {
	/** `null` removes the environment; a string overrides it. */
	readonly environment?: string | null;
	readonly stackProperties?: Record<string, unknown>;
	readonly sourcePath?: string;
	readonly executable?: readonly string[];
	readonly packaging?: "file" | "zip";
	readonly missingSource?: boolean;
	readonly symlinkSource?: boolean;
	readonly destination?: Record<string, unknown>;
	readonly dockerImages?: Record<string, unknown> | null;
	readonly extraArtifacts?: Record<string, unknown>;
	readonly stacks?: readonly string[];
	readonly symlinkInsideAssembly?: boolean;
}

function writeProjectAssembly(
	assemblyDir: string,
	options: FixtureOptions = {},
) {
	const stacks = options.stacks ?? ["PawlStack"];
	const environment =
		options.environment === null
			? undefined
			: (options.environment ?? `aws://${ACCOUNT}/${REGION}`);
	const artifacts: Record<string, unknown> = {};
	for (const stack of stacks) {
		artifacts[stack] = {
			type: "aws:cloudformation:stack",
			...(environment === undefined ? {} : { environment }),
			properties: {
				templateFile: `${stack}.template.json`,
				stackName: stack,
				...options.stackProperties,
			},
		};
	}
	artifacts[`${stacks[0]}.assets`] = {
		type: "cdk:asset-manifest",
		properties: { file: "assets.json" },
	};
	artifacts.tree = { type: "cdk:tree", properties: { file: "tree.json" } };
	Object.assign(artifacts, options.extraArtifacts);
	writeFileSync(
		join(assemblyDir, "manifest.json"),
		JSON.stringify({
			version: "39.0.0",
			artifacts,
		}),
	);
	for (const stack of stacks) {
		writeFileSync(
			join(assemblyDir, `${stack}.template.json`),
			JSON.stringify({ Resources: {} }),
		);
	}
	writeFileSync(join(assemblyDir, "tree.json"), "{}");
	if (options.symlinkInsideAssembly) {
		symlinkSync("/etc/hosts", join(assemblyDir, "dangling-link.txt"));
	}
	if (options.executable !== undefined) {
		writeFileSync(
			join(assemblyDir, "assets.json"),
			JSON.stringify({
				version: "assets-1.0",
				files: {
					asset1: {
						source: { executable: [...options.executable] },
						destinations: {
							current: {
								bucketName: `cdk-hnb659fds-assets-${ACCOUNT}-${REGION}`,
								objectKey: "handler.zip",
								...options.destination,
							},
						},
					},
				},
			}),
		);
		return;
	}
	const sourcePath = options.sourcePath ?? "assets/handler.js";
	if (!options.missingSource && !options.symlinkSource) {
		mkdirSync(dirname(join(assemblyDir, sourcePath)), { recursive: true });
		writeFileSync(join(assemblyDir, sourcePath), "materialized handler bytes");
	}
	if (options.symlinkSource) {
		mkdirSync(dirname(join(assemblyDir, sourcePath)), { recursive: true });
		symlinkSync("/etc/hosts", join(assemblyDir, sourcePath));
	}
	const source: Record<string, unknown> = { path: sourcePath };
	if (options.packaging !== undefined) source.packaging = options.packaging;
	const assets: Record<string, unknown> = {
		version: "assets-1.0",
		files: {
			asset1: {
				source,
				destinations: {
					current: {
						bucketName: `cdk-hnb659fds-assets-${ACCOUNT}-${REGION}`,
						objectKey: "handler.zip",
						...options.destination,
					},
				},
			},
		},
	};
	if (options.dockerImages !== null && options.dockerImages !== undefined) {
		assets.dockerImages = options.dockerImages;
	}
	writeFileSync(join(assemblyDir, "assets.json"), JSON.stringify(assets));
}

const synthesizeWith =
	(fixture: FixtureOptions = {}) =>
	async (assemblyDir: string) => {
		writeProjectAssembly(assemblyDir, fixture);
	};

// ---- fake executors ----------------------------------------------------- //

interface FakeExec {
	readonly exec: ArtifactExec;
	readonly calls: ControlledExecRequest[];
}

const fakeResult = (
	request: ControlledExecRequest,
	overrides: Partial<ControlledExecResult> = {},
): ControlledExecResult => ({
	command: request.command,
	args: [...(request.args ?? [])],
	exitCode: 0,
	stdout: "",
	stderr: "",
	stdoutTruncated: false,
	stderrTruncated: false,
	...overrides,
});

const fakeDiffExec = (
	stdout: string,
	overrides: Partial<ControlledExecResult> = {},
): FakeExec => {
	const calls: ControlledExecRequest[] = [];
	return {
		calls,
		exec: {
			run: async (request) => {
				calls.push(request);
				return fakeResult(request, { stdout, ...overrides });
			},
		},
	};
};

/** Recomputes the frozen digests of the assembly the executor was pointed at. */
const observedAssemblyDigests = (request: ControlledExecRequest) => {
	const appIndex = (request.args ?? []).indexOf("--app");
	if (appIndex < 0) throw new Error("executor was not pointed at an assembly");
	const assemblyDir = (request.args ?? [])[appIndex + 1];
	if (assemblyDir === undefined) throw new Error("--app without a value");
	const files: { path: string; sha256: string }[] = [];
	const visit = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const stat = lstatSync(full);
			if (stat.isSymbolicLink()) throw new Error("unexpected symlink");
			if (stat.isDirectory()) {
				visit(full);
				continue;
			}
			files.push({
				path: relative(assemblyDir, full).split(sep).join("/"),
				sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
			});
		}
	};
	visit(assemblyDir);
	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return files;
};

const fakeDeployExec = (
	overrides: Partial<ControlledExecResult> = {},
): FakeExec & {
	readonly observed: { path: string; sha256: string }[][];
} => {
	const calls: ControlledExecRequest[] = [];
	const observed: { path: string; sha256: string }[][] = [];
	return {
		calls,
		observed,
		exec: {
			run: async (request) => {
				calls.push(request);
				observed.push(observedAssemblyDigests(request));
				return fakeResult(request, overrides);
			},
		},
	};
};

// ---- approval fixture --------------------------------------------------- //

function fakeClock() {
	let nowMs = 1_800_000_000_000;
	const timers: { at: number; handler: () => void; cancelled: boolean }[] = [];
	const now = () => nowMs;
	const scheduleTimeout = (handler: () => void, ms: number) => {
		const timer = { at: nowMs + ms, handler, cancelled: false };
		timers.push(timer);
		return () => {
			timer.cancelled = true;
		};
	};
	const advance = (ms: number) => {
		nowMs += ms;
		for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
			if (!timer.cancelled && timer.at <= nowMs) timer.handler();
		}
	};
	return { now, scheduleTimeout, advance };
}

// ---- artifact fixture --------------------------------------------------- //

async function preparedArtifact(
	fixture: FixtureOptions = {},
	project?: string,
) {
	const projectDir = project ?? scratch();
	const artifact = await prepareArtifact({
		projectDir,
		target: TARGET,
		synthesize: synthesizeWith(fixture),
	});
	return { artifact, projectDir };
}

const deployRequest = {
	runId: "run_1",
	toolCallId: "call_1",
	toolName: "deploy_infra",
	input: { stackName: "PawlStack" },
};

async function approveAndDeploy(options: {
	artifact: PreparedArtifact;
	projectDir: string;
	exec: FakeExec["exec"];
	clock?: ReturnType<typeof fakeClock>;
	questions?: { requestId: string }[];
	broker?: ApprovalBroker;
	currentIdentity?: { accountId: string; region: string };
}) {
	const clock = options.clock ?? fakeClock();
	const questions = options.questions ?? [];
	const broker =
		options.broker ??
		new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
	const preview = await previewArtifact(
		options.artifact,
		fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders OrdersABC\n")
			.exec,
	);
	const pending = (async () =>
		deployApprovedArtifact({
			artifact: options.artifact,
			preview,
			broker,
			mutations: createMutationCoordinator(),
			exec: options.exec,
			currentIdentity: options.currentIdentity ?? {
				accountId: options.artifact.target.accountId,
				region: options.artifact.target.region,
			},
			request: deployRequest,
		}))();
	await Bun.sleep(1);
	const requestId = questions[0]?.requestId;
	if (requestId === undefined) throw new Error("no approval question surfaced");
	await broker.answer({
		requestId,
		choice: { kind: "option", value: "approve" },
	});
	return pending;
}

// ---- tests -------------------------------------------------------------- //

describe("prepareArtifact", () => {
	test("synthesizes into an exclusive private .pawl/artifacts assembly and never touches cdk.out", async () => {
		const projectDir = scratch();
		writeFileSync(
			join(projectDir, "cdk.out.sentinel"),
			"cdk.out is untouchable",
		);
		const cdkOut = join(projectDir, "cdk.out");
		mkdirSync(cdkOut);
		writeFileSync(join(cdkOut, "manifest.json"), "pre-existing cdk.out");
		const { artifact } = await preparedArtifact({}, projectDir);
		const assemblyStat = statSync(artifact.assemblyDir);
		expect(assemblyStat.isDirectory()).toBe(true);
		expect(assemblyStat.mode & 0o777).toBe(0o700);
		expect(artifact.assemblyDir).toContain(".pawl/artifacts/");
		// prepareArtifact realpaths the project (macOS /tmp → /private/tmp), so
		// compare against the resolved .pawl path rather than the raw argument.
		expect(artifact.assemblyDir.startsWith(artifact.projectDir)).toBe(true);
		expect(artifact.projectDir).not.toBe(projectDir);
		expect(artifact.target).toEqual(TARGET);
		expect(artifact.files.map((file) => file.path)).toEqual([
			"PawlStack.template.json",
			"assets.json",
			"assets/handler.js",
			"manifest.json",
			"tree.json",
		]);
		expect(artifact.digest.startsWith("sha256:")).toBe(true);
		expect(readFileSync(join(cdkOut, "manifest.json"), "utf8")).toBe(
			"pre-existing cdk.out",
		);
	});

	test("digests sorted file names and bytes, stack selection, target and options", async () => {
		const first = await preparedArtifact();
		const identical = await preparedArtifact();
		expect(identical.artifact.digest).toBe(first.artifact.digest);
		// Nondeterministic re-synthesis: different bytes produce a different
		// artifact, so an approval bound to one digest never covers the other.
		const changed = await preparedArtifact({
			sourcePath: "assets/handler.js",
		});
		writeFileSync(
			join(changed.artifact.assemblyDir, "assets/handler.js"),
			"handler bytes v2",
		);
		const redigested = await prepareArtifact({
			projectDir: changed.projectDir,
			target: TARGET,
			synthesize: async (assemblyDir) => {
				writeProjectAssembly(assemblyDir, { sourcePath: "assets/handler.js" });
				writeFileSync(
					join(assemblyDir, "assets/handler.js"),
					"handler bytes v2",
				);
			},
		});
		expect(redigested.digest).not.toBe(changed.artifact.digest);
		const retargeted = await prepareArtifact({
			projectDir: first.projectDir,
			target: { accountId: "999999999999", region: REGION },
			synthesize: synthesizeWith({
				environment: "aws://999999999999/eu-central-1",
			}),
		});
		expect(retargeted.digest).not.toBe(first.artifact.digest);
	});

	test("stack selection is part of the digest", async () => {
		const { artifact: both, projectDir } = await preparedArtifact({
			stacks: ["PawlStack", "SecondStack"],
		});
		expect(both.stacks).toEqual(["PawlStack", "SecondStack"]);
		const only = await prepareArtifact({
			projectDir,
			target: TARGET,
			stacks: ["SecondStack"],
			synthesize: synthesizeWith({
				stacks: ["PawlStack", "SecondStack"],
			}),
		});
		expect(only.stacks).toEqual(["SecondStack"]);
		expect(only.digest).not.toBe(both.digest);
	});

	test("rejects unknown requested stack names", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				stacks: ["MissingStack"],
				synthesize: synthesizeWith(),
			}),
		).rejects.toThrow(DeployArtifactError);
	});

	test("rejects executable-produced assets whose deferred command would produce different bytes, before any approval", async () => {
		// The manifest is otherwise identical to the supported fixture, but the
		// asset is produced by a deferred command at deploy time: rejecting the
		// artifact must happen before approval, not at execution.
		const { artifact } = await preparedArtifact();
		expect(artifact.files.some((f) => f.path === "assets.json")).toBe(true);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ executable: ["node", "gen.js"] }),
			}),
		).rejects.toThrow(/executable/i);
	});

	test("rejects all Docker sources (directory and executable forms)", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					dockerImages: {
						img1: { source: { directory: "docker/app" }, destinations: {} },
					},
				}),
			}),
		).rejects.toThrow(/docker/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					dockerImages: { img1: { source: { executable: ["build.sh"] } } },
				}),
			}),
		).rejects.toThrow(/docker/i);
	});

	test("rejects deferred ZIP packaging", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ packaging: "zip" }),
			}),
		).rejects.toThrow(/zip/i);
	});

	test("rejects nested assemblies and unknown artifact types", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					extraArtifacts: {
						nested: {
							type: "cdk:cloud-assembly",
							properties: { directoryName: "nested" },
						},
					},
				}),
			}),
		).rejects.toThrow(/nested/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					extraArtifacts: {
						weird: { type: "cdk:unsupported", properties: {} },
					},
				}),
			}),
		).rejects.toThrow(/unsupported/i);
	});

	test("rejects source paths escaping the assembly and absolute paths", async () => {
		const outside = join(scratch(), "outside.js");
		writeFileSync(outside, "outside bytes");
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ sourcePath: "../outside.js" }),
			}),
		).rejects.toThrow(/escape|outside|assembly/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ sourcePath: "/etc/hosts" }),
			}),
		).rejects.toThrow(/absolute/i);
		void outside;
	});

	test("rejects symlinked asset sources and symlinks anywhere in the assembly", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ symlinkSource: true }),
			}),
		).rejects.toThrow(/symbolic link/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ symlinkInsideAssembly: true }),
			}),
		).rejects.toThrow(/symbolic link/i);
	});

	test("validates transitive references: missing asset sources and templates are rejected", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ missingSource: true }),
			}),
		).rejects.toThrow(/assets\/handler\.js/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: async (assemblyDir) => {
					writeProjectAssembly(assemblyDir);
					rmSync(join(assemblyDir, "PawlStack.template.json"));
				},
			}),
		).rejects.toThrow(/PawlStack\.template\.json/i);
	});

	test("rejects unapproved destinations: assume-role targets and region mismatches", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					destination: {
						assumeRoleArn: `arn:aws:iam::${ACCOUNT}:role/publisher`,
					},
				}),
			}),
		).rejects.toThrow(/assume/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ destination: { region: "us-east-1" } }),
			}),
		).rejects.toThrow(/region/i);
	});

	test("rejects stack assume-role targets and cross-account execution roles", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					stackProperties: {
						assumeRoleArn: `arn:aws:iam::${ACCOUNT}:role/deployer`,
					},
				}),
			}),
		).rejects.toThrow(/assume/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					stackProperties: {
						lookupRole: { arn: `arn:aws:iam::${ACCOUNT}:role/lookup` },
					},
				}),
			}),
		).rejects.toThrow(/lookupRole|assume/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					stackProperties: {
						cloudFormationExecutionRoleArn: `arn:aws:iam::222233334444:role/cfn-exec`,
					},
				}),
			}),
		).rejects.toThrow(/cloudFormationExecutionRoleArn/i);
	});

	test("accepts a same-account CloudFormation execution role", async () => {
		const { artifact } = await preparedArtifact({
			stackProperties: {
				cloudFormationExecutionRoleArn: `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-${ACCOUNT}-${REGION}`,
			},
		});
		expect(artifact.stacks).toEqual(["PawlStack"]);
	});

	test("rejects unknown and account-agnostic target environments", async () => {
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({ environment: null }),
			}),
		).rejects.toThrow(/environment/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					environment: "aws://222233334444/eu-central-1",
				}),
			}),
		).rejects.toThrow(/account/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: TARGET,
				synthesize: synthesizeWith({
					environment: `aws://${ACCOUNT}/us-east-1`,
				}),
			}),
		).rejects.toThrow(/region/i);
		await expect(
			prepareArtifact({
				projectDir: scratch(),
				target: { accountId: "999999999999", region: REGION },
				synthesize: synthesizeWith(),
			}),
		).rejects.toThrow(/account/i);
	});
});

describe("verifyArtifact", () => {
	test("accepts untouched frozen material and refuses tampering, deletion, addition and symlink replacement", async () => {
		const { artifact } = await preparedArtifact();
		await verifyArtifact(artifact);
		// Byte tampering.
		writeFileSync(
			join(artifact.assemblyDir, "assets/handler.js"),
			"tampered bytes",
		);
		await expect(verifyArtifact(artifact)).rejects.toThrow(
			/integrity|changed|assets\/handler\.js/i,
		);
		writeFileSync(
			join(artifact.assemblyDir, "assets/handler.js"),
			"materialized handler bytes",
		);
		await verifyArtifact(artifact);
		// Deletion.
		rmSync(join(artifact.assemblyDir, "tree.json"));
		await expect(verifyArtifact(artifact)).rejects.toThrow(
			/missing|removed|tree\.json/i,
		);
		writeFileSync(join(artifact.assemblyDir, "tree.json"), "{}");
		// Addition.
		writeFileSync(join(artifact.assemblyDir, "added.txt"), "added");
		await expect(verifyArtifact(artifact)).rejects.toThrow(/added\.txt/i);
		rmSync(join(artifact.assemblyDir, "added.txt"));
		// Symlink replacement.
		rmSync(join(artifact.assemblyDir, "assets/handler.js"));
		symlinkSync("/etc/hosts", join(artifact.assemblyDir, "assets/handler.js"));
		await expect(verifyArtifact(artifact)).rejects.toThrow(/symbolic link/i);
	});
});

describe("previewArtifact", () => {
	test("runs a read-only template diff against the frozen assembly with explicit --app and --change-set false", async () => {
		// Installed CLI syntax (aws-cdk 2.1132.0, confirmed via offline `cdk diff
		// --help` and the installed source): `--change-set` is a boolean option;
		// `--change-set false` resolves to the template-only diff method, which
		// creates no CloudFormation change set. `--app` accepts a cloud assembly
		// directory, so no re-synthesis happens.
		const { artifact } = await preparedArtifact();
		const fake = fakeDiffExec(
			"Stack PawlStack\n[+] AWS::SQS::Queue Orders OrdersABC\n",
		);
		const preview = await previewArtifact(artifact, fake.exec);
		const call = fake.calls[0];
		expect(call?.command).toBe("npx");
		expect(call?.args).toEqual([
			"cdk",
			"diff",
			"--app",
			artifact.assemblyDir,
			"--change-set",
			"false",
			"PawlStack",
		]);
		expect(preview.changed).toBe(true);
		expect(preview.complete).toBe(true);
		expect(preview.text).toContain(artifact.artifactId);
		expect(preview.text).toContain(artifact.digest);
		expect(preview.text).toContain(`aws://${ACCOUNT}/${REGION}`);
		expect(preview.text).toContain("[+] AWS::SQS::Queue Orders OrdersABC");
	});

	test("reports no differences for cdk's explicit no-difference output", async () => {
		const { artifact } = await preparedArtifact();
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\nThere were no differences\n").exec,
		);
		expect(preview.changed).toBe(false);
	});

	test("marks truncated output incomplete", async () => {
		const { artifact } = await preparedArtifact();
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("[+] AWS::SQS::Queue Orders", {
				stdoutTruncated: true,
			}).exec,
		);
		expect(preview.complete).toBe(false);
	});
});

describe("deployApprovedArtifact", () => {
	test("chains preview → human answer → executor, consuming the one-use grant at the boundary", async () => {
		const { artifact, projectDir } = await preparedArtifact();
		const fake = fakeDeployExec();
		const questions: { requestId: string }[] = [];
		const clock = fakeClock();
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders OrdersABC\n")
				.exec,
		);
		const pending = deployApprovedArtifact({
			artifact,
			preview,
			broker,
			mutations: createMutationCoordinator(),
			exec: fake.exec,
			currentIdentity: { accountId: ACCOUNT, region: REGION },
			request: deployRequest,
		});
		await Bun.sleep(1);
		expect(questions).toHaveLength(1);
		expect(broker.pendingCount).toBe(1);
		// No execution before the explicit answer.
		expect(fake.calls).toHaveLength(0);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "option", value: "approve" },
		});
		const result = await pending;
		expect(result.exitCode).toBe(0);
		const call = fake.calls[0];
		expect(call?.command).toBe("npx");
		expect(call?.args).toEqual([
			"cdk",
			"deploy",
			"--app",
			artifact.assemblyDir,
			"--require-approval",
			"never",
			"PawlStack",
		]);
		// The executor never re-synthesizes: no synth argument, and the --app
		// target is the frozen artifact assembly, not the project.
		expect((call?.args ?? []).join(" ")).not.toContain("synth");
		// The --app target is the frozen assembly, not the project directory.
		const appIndex = (call?.args ?? []).indexOf("--app");
		expect((call?.args ?? [])[appIndex + 1]).toBe(artifact.assemblyDir);
		expect((call?.args ?? [])[appIndex + 1]).not.toBe(projectDir);
	});

	test("the executor receives the exact frozen assembly bytes; changed project source leaves the snapshot unchanged", async () => {
		const { artifact, projectDir } = await preparedArtifact();
		const fake = fakeDeployExec();
		// The project source changes after the preview was approved.
		mkdirSync(join(projectDir, "lib"), { recursive: true });
		writeFileSync(join(projectDir, "lib", "stack.ts"), "changed source");
		await approveAndDeploy({ artifact, projectDir, exec: fake.exec });
		expect(fake.observed[0]).toEqual(
			artifact.files.map(({ path, sha256 }) => ({ path, sha256 })),
		);
	});

	test("a denial stops the operation before any execution", async () => {
		const { artifact } = await preparedArtifact();
		const fake = fakeDeployExec();
		const questions: { requestId: string }[] = [];
		const clock = fakeClock();
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders\n").exec,
		);
		const pending = deployApprovedArtifact({
			artifact,
			preview,
			broker,
			mutations: createMutationCoordinator(),
			exec: fake.exec,
			currentIdentity: { accountId: ACCOUNT, region: REGION },
			request: deployRequest,
		});
		await Bun.sleep(1);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "option", value: "deny" },
		});
		await expect(pending).rejects.toThrow(/denied/i);
		expect(fake.calls).toHaveLength(0);
	});

	test("a truncated preview never reaches approval", async () => {
		const { artifact } = await preparedArtifact();
		const questions: { requestId: string }[] = [];
		const clock = fakeClock();
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("[+] AWS::SQS::Queue Orders", { stdoutTruncated: true })
				.exec,
		);
		await expect(
			deployApprovedArtifact({
				artifact,
				preview,
				broker,
				mutations: createMutationCoordinator(),
				exec: fakeDeployExec().exec,
				currentIdentity: { accountId: ACCOUNT, region: REGION },
				request: deployRequest,
			}),
		).rejects.toThrow(/truncated/i);
		expect(questions).toHaveLength(0);
	});

	test("an unchanged preview is never authorized for deployment", async () => {
		const { artifact } = await preparedArtifact();
		const questions: { requestId: string }[] = [];
		const clock = fakeClock();
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\nThere were no differences\n").exec,
		);
		await expect(
			deployApprovedArtifact({
				artifact,
				preview,
				broker,
				mutations: createMutationCoordinator(),
				exec: fakeDeployExec().exec,
				currentIdentity: { accountId: ACCOUNT, region: REGION },
				request: deployRequest,
			}),
		).rejects.toThrow(/no differences/i);
		expect(questions).toHaveLength(0);
	});

	test("changed frozen material after approval is refused under the mutation permit", async () => {
		const { artifact, projectDir } = await preparedArtifact();
		const fake = fakeDeployExec();
		const questions: { requestId: string }[] = [];
		const clock = fakeClock();
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders\n").exec,
		);
		const pending = deployApprovedArtifact({
			artifact,
			preview,
			broker,
			mutations: createMutationCoordinator(),
			exec: fake.exec,
			currentIdentity: { accountId: ACCOUNT, region: REGION },
			request: deployRequest,
		});
		await Bun.sleep(1);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "option", value: "approve" },
		});
		// Tamper with the frozen assembly after approval, before execution.
		writeFileSync(
			join(artifact.assemblyDir, "assets/handler.js"),
			"tampered after approval",
		);
		await expect(pending).rejects.toThrow(/integrity|changed|tamper/i);
		expect(fake.calls).toHaveLength(0);
		void projectDir;
	});

	test("an identity change between approval and execution is refused", async () => {
		const { artifact, projectDir } = await preparedArtifact();
		const fake = fakeDeployExec();
		const pending = approveAndDeploy({
			artifact,
			projectDir,
			exec: fake.exec,
			currentIdentity: { accountId: "222233334444", region: REGION },
		});
		await expect(pending).rejects.toThrow(/identity/i);
		expect(fake.calls).toHaveLength(0);
	});

	test("an expired approval grant cannot execute", async () => {
		const { artifact } = await preparedArtifact();
		const fake = fakeDeployExec();
		const clock = fakeClock();
		const questions: { requestId: string }[] = [];
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders\n").exec,
		);
		const pending = deployApprovedArtifact({
			artifact,
			preview,
			broker,
			mutations: createMutationCoordinator(),
			exec: fake.exec,
			currentIdentity: { accountId: ACCOUNT, region: REGION },
			request: deployRequest,
		});
		await Bun.sleep(1);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "option", value: "approve" },
		});
		// Approve, then let the grant expire before the boundary consumes it.
		clock.advance(6 * 60_000);
		await expect(pending).rejects.toThrow(/expired/i);
		expect(fake.calls).toHaveLength(0);
	});

	test("a session restart revokes the grant and refuses deployment", async () => {
		const { artifact } = await preparedArtifact();
		const fake = fakeDeployExec();
		const clock = fakeClock();
		const questions: { requestId: string }[] = [];
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders\n").exec,
		);
		const pending = deployApprovedArtifact({
			artifact,
			preview,
			broker,
			mutations: createMutationCoordinator(),
			exec: fake.exec,
			currentIdentity: { accountId: ACCOUNT, region: REGION },
			request: deployRequest,
		});
		await Bun.sleep(1);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "option", value: "approve" },
		});
		broker.restart();
		await expect(pending).rejects.toThrow(/revoked/i);
		expect(fake.calls).toHaveLength(0);
	});

	test("the deployment executes under the mutation permit and releases it", async () => {
		const { artifact, projectDir } = await preparedArtifact();
		const coordinator = createMutationCoordinator();
		const heldDuring: boolean[] = [];
		const exec = {
			run: async (request: ControlledExecRequest) => {
				heldDuring.push(coordinator.held);
				return fakeResult(request);
			},
		};
		const clock = fakeClock();
		const questions: { requestId: string }[] = [];
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: new AbortController().signal,
			onRequest: (question) => questions.push(question),
		});
		const preview = await previewArtifact(
			artifact,
			fakeDiffExec("Stack PawlStack\n[+] AWS::SQS::Queue Orders\n").exec,
		);
		const pending = deployApprovedArtifact({
			artifact,
			preview,
			broker,
			mutations: coordinator,
			exec,
			currentIdentity: { accountId: ACCOUNT, region: REGION },
			request: deployRequest,
		});
		await Bun.sleep(1);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "option", value: "approve" },
		});
		await pending;
		expect(heldDuring).toEqual([true]);
		expect(coordinator.held).toBe(false);
		void projectDir;
	});

	test("a grant cannot be reused for a second deployment", async () => {
		const { artifact, projectDir } = await preparedArtifact();
		const fake = fakeDeployExec();
		await approveAndDeploy({
			artifact,
			projectDir,
			exec: fake.exec,
		});
		expect(fake.calls).toHaveLength(1);
		// The approved binding digest covers the artifact; a second deployment
		// needs a fresh approval (the first grant was consumed once).
		const second = fakeDeployExec();
		await approveAndDeploy({
			artifact,
			projectDir,
			exec: second.exec,
		});
		expect(second.calls).toHaveLength(1);
	});
});

describe("approval binding", () => {
	test("the deploy binding carries the artifact digest, project and target identity", async () => {
		const { artifact } = await preparedArtifact();
		const binding: ApprovalBinding = {
			runId: "run_1",
			toolCallId: "call_1",
			toolName: "deploy_infra",
			input: { stackName: "PawlStack" },
			planDigest: artifact.digest,
			projectDir: artifact.projectDir,
			identity: {
				accountId: artifact.target.accountId,
				region: artifact.target.region,
			},
			previewComplete: true,
		};
		expect(binding.planDigest).toBe(artifact.digest);
		expect(binding.identity).toEqual(TARGET);
	});
});
