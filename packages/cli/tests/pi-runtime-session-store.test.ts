import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import {
	CODEC_VERSION,
	encodeRecordLine,
	parseSessionLog,
	recoverSessionContext,
	SESSION_RECORD_VERSION,
	type SessionRecord,
	toolIntentDigest,
} from "../src/pi-runtime/session-record";
import {
	createSessionStore,
	openSessionStore,
	readSessionLog,
	type SessionFileHandle,
	type SessionMetadata,
	type SessionStoreDependencies,
	SessionStoreError,
} from "../src/pi-runtime/session-store";

async function realOpenHandle(
	path: string,
	flag: "a" | "wx",
	mode: number,
): Promise<SessionFileHandle> {
	const handle = await open(path, flag, mode);
	return {
		appendLine: async (line: string) => {
			await handle.appendFile(`${line}\n`, "utf8");
		},
		sync: () => handle.sync(),
		close: () => handle.close(),
	};
}

/** Wraps the real handle so the next append can be made to fail once. */
function failingOpenHandle(): {
	openHandle: NonNullable<SessionStoreDependencies["openHandle"]>;
	failNext: () => void;
} {
	let fail = false;
	return {
		failNext: () => {
			fail = true;
		},
		openHandle: async (path, flag, mode) => {
			const real = await realOpenHandle(path, flag, mode);
			return {
				appendLine: async (line: string) => {
					if (fail) {
						fail = false;
						throw new Error("injected write failure");
					}
					await real.appendLine(line);
				},
				sync: () => real.sync(),
				close: () => real.close(),
			};
		},
	};
}

const identity = {
	accountId: "123456789012",
	region: "eu-central-1",
	principalArn: "arn:aws:iam::123456789012:user/jolo",
};

const model = { id: "eu.amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" };

function headerLine(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		v: SESSION_RECORD_VERSION,
		kind: "header",
		codec: CODEC_VERSION,
		sessionId: "s1",
		projectPath: "/fixture/project",
		identity,
		model,
		createdAt: 1234,
		...overrides,
	});
}

function messageRecord(seq: number, message: Message): SessionRecord {
	return {
		v: SESSION_RECORD_VERSION,
		kind: "message",
		seq,
		timestamp: message.timestamp,
		message,
	};
}

function userMessage(text: string, timestamp = 1000): Message {
	return { role: "user", content: text, timestamp };
}

function assistantMessage(
	content: unknown,
	overrides: Record<string, unknown> = {},
): Message {
	return {
		role: "assistant",
		content,
		api: "bedrock-converse-stream",
		provider: "amazon-bedrock",
		model: model.id,
		usage: {
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 20,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2000,
		...overrides,
	} as Message;
}

function toolResultMessage(
	toolCallId: string,
	text: string,
	timestamp = 3000,
): Message {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "scan_resources",
		content: [{ type: "text", text }],
		isError: false,
		timestamp,
	} as Message;
}

/** A stable fake bedrock model for the actual provider payload conversion. */
const fakeBedrockModel = {
	id: model.id,
	name: "Nova 2 Lite",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	input: [],
	output: ["text"],
	tool_call: true,
	reasoning: false,
	contextWindow: 200000,
	maxTokens: 4096,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as never;

function asMessages(context: readonly unknown[]): Message[] {
	return [...context] as unknown as Message[];
}

function toolCallIds(messages: readonly Message[]): string[] {
	return messages.flatMap((message) =>
		message.role === "assistant"
			? message.content
					.filter((block) => block.type === "toolCall")
					.map((block) => block.id)
			: [],
	);
}

function toolResultIds(messages: readonly Message[]): string[] {
	return messages
		.filter((message) => message.role === "toolResult")
		.map((message) => message.toolCallId);
}

describe("session record codec", () => {
	test("header encodes strict identity/model metadata and round-trips", () => {
		const parsed = parseSessionLog(`${headerLine()}\n`);
		expect(parsed.header).toEqual(JSON.parse(headerLine()));
		expect(parsed.records).toEqual([]);
		expect(parsed.tailDiscarded).toBe(false);
	});

	test("header rejects unknown fields so credentials and env dumps cannot be recorded", () => {
		for (const poison of [
			{ credentials: { accessKeyId: "AKIA" } },
			{ env: { AWS_SECRET_ACCESS_KEY: "x" } },
			{ sessionToken: "tok" },
		]) {
			expect(() =>
				parseSessionLog(
					`${JSON.stringify({ ...JSON.parse(headerLine()), ...poison })}\n`,
				),
			).toThrow(/header/i);
		}
	});

	test("header rejects an unsupported version, codec and non-header first lines", () => {
		for (const bad of [
			headerLine({ v: 2 }),
			headerLine({ codec: 2 }),
			JSON.stringify({ v: 1, kind: "message", seq: 1, timestamp: 1 }),
			"not json",
		]) {
			expect(() => parseSessionLog(`${bad}\n`)).toThrow(/header|format/i);
		}
	});

	test("messages round-trip with opaque provider fields preserved byte-for-byte", () => {
		const oddSignature = 'sig–with\nescapes\t\u00e9\u4f60\u597d |json&"quotes"';
		const messages: Message[] = [
			userMessage(
				'typed "secret-looking" string: aws_secret_access_key = REDACTED-NOPE',
			),
			assistantMessage(
				[
					{
						type: "thinking",
						thinking: "reasoning",
						thinkingSignature: oddSignature,
					},
					{ type: "text", text: "hello" },
					{
						type: "toolCall",
						id: "call-1",
						name: "scan_resources",
						arguments: { region: "eu-central-1" },
						thoughtSignature: oddSignature,
					},
				],
				{
					responseId: "resp-1",
					responseModel: "nova",
				},
			),
			toolResultMessage("call-1", "done"),
		];
		const log = [
			headerLine(),
			...messages.map((message, index) =>
				encodeRecordLine(messageRecord(index + 1, message)),
			),
		].join("\n");
		const parsed = parseSessionLog(`${log}\n`);
		expect(
			parsed.records.map((record) =>
				record.kind === "message" ? record.message : null,
			),
		).toEqual(messages);
		const assistant = parsed.records[1];
		if (
			assistant?.kind !== "message" ||
			assistant.message.role !== "assistant"
		) {
			throw new Error("Expected assistant record");
		}
		const thinking = assistant.message.content[0];
		if (thinking?.type !== "thinking")
			throw new Error("Expected thinking block");
		expect(thinking.thinkingSignature).toBe(oddSignature);
	});

	test("unknown record kinds, bad sequences and duplicate headers fail closed", () => {
		const head = `${headerLine()}\n`;
		expect(() =>
			parseSessionLog(
				`${head}${JSON.stringify({ v: 1, kind: "approval_grant", seq: 1, timestamp: 1, grant: "x" })}\n`,
			),
		).toThrow(/record/i);
		expect(() =>
			parseSessionLog(
				`${head}${encodeRecordLine({ v: 1, kind: "message", seq: 2, timestamp: 1, message: userMessage("hi") })}\n`,
			),
		).toThrow(/sequence/i);
		expect(() => parseSessionLog(`${head}${headerLine()}\n`)).toThrow(
			/record/i,
		);
	});

	test("terminated invalid records fail closed with a line number; unterminated tails are discarded", () => {
		const head = `${headerLine()}\n`;
		// Corrupted middle record: fail closed, without leaking record contents.
		try {
			parseSessionLog(
				`${head}{broken\n${encodeRecordLine(messageRecord(1, userMessage("ok")))}`,
			);
			throw new Error("Expected parse failure");
		} catch (error) {
			expect((error as Error).message).toMatch(/line 2/i);
		}
		// Terminated but invalid final record: corruption, not a tail.
		expect(() =>
			parseSessionLog(
				`${head}${JSON.stringify({ v: 1, kind: "message", seq: 9, timestamp: 1, message: userMessage("x") })}\n`,
			),
		).toThrow(/sequence/i);
		// Unterminated final line: conservative uncommitted-tail discard.
		const tail = parseSessionLog(
			`${head}{"v":1,"kind":"message","seq":1,"time`,
		);
		expect(tail.tailDiscarded).toBe(true);
		expect(tail.records).toEqual([]);
		// A fully terminated log is never marked as a tail.
		const complete = parseSessionLog(
			`${head}${encodeRecordLine(messageRecord(1, userMessage("x")))}\n`,
		);
		expect(complete.tailDiscarded).toBe(false);
		expect(complete.records).toHaveLength(1);
	});

	test("records decode in order with monotonic sequences", () => {
		const lines = [headerLine()];
		for (let seq = 1; seq <= 5; seq++) {
			lines.push(
				encodeRecordLine(messageRecord(seq, userMessage(`m${seq}`, seq))),
			);
		}
		const parsed = parseSessionLog(`${lines.join("\n")}\n`);
		expect(parsed.records.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5]);
	});

	test("a terminated blank middle line fails closed; trailing blank lines at EOF are conservative", () => {
		const head = headerLine();
		const record = encodeRecordLine(messageRecord(1, userMessage("x")));
		try {
			parseSessionLog(`${head}\n\n${record}\n`);
			throw new Error("Expected blank middle line failure");
		} catch (error) {
			expect((error as Error).message).toMatch(/blank/i);
			expect((error as Error).message).toContain("line 2");
		}
		// Trailing blank lines at EOF fall under the same conservative tail rule.
		const ok = parseSessionLog(`${head}\n${record}\n\n`);
		expect(ok.records).toHaveLength(1);
		expect(ok.tailDiscarded).toBe(false);
	});

	test("toolIntentDigest is a sha256 hex digest over the stable-stringified arguments", () => {
		const digest = toolIntentDigest({ region: "eu-central-1", depth: 2 });
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		// Deterministic over canonical JSON, independent of key order.
		expect(toolIntentDigest({ depth: 2, region: "eu-central-1" })).toBe(digest);
	});
});

describe("session record recovery", () => {
	test("preserves completed results and fills only missing ones with interrupted notices", () => {
		const records: SessionRecord[] = [
			messageRecord(1, userMessage("go")),
			messageRecord(
				2,
				assistantMessage([
					{
						type: "toolCall",
						id: "call-a",
						name: "scan_resources",
						arguments: {},
					},
					{
						type: "toolCall",
						id: "call-b",
						name: "scan_resources",
						arguments: {},
					},
					{
						type: "toolCall",
						id: "call-c",
						name: "scan_resources",
						arguments: {},
					},
				]),
			),
			messageRecord(3, toolResultMessage("call-a", "done")),
		];
		const recovered = recoverSessionContext(records);
		const modelContext = asMessages(recovered.modelContext);
		expect(toolCallIds(modelContext)).toEqual(["call-a", "call-b", "call-c"]);
		expect(toolResultIds(modelContext)).toEqual(["call-a", "call-b", "call-c"]);
		const filled = modelContext.filter(
			(message) =>
				message.role === "toolResult" && message.toolCallId !== "call-a",
		);
		expect(filled).toHaveLength(2);
		for (const message of filled) {
			if (message.role !== "toolResult") throw new Error("Expected toolResult");
			expect(message.isError).toBe(true);
			const block = message.content[0];
			if (block?.type !== "text") throw new Error("Expected text block");
			expect(block.text).toMatch(/interrupt|unknown/i);
		}
		// The original log is untouched: fills happen only in recovered context.
		expect(records.filter((record) => record.kind === "message")).toHaveLength(
			3,
		);
	});

	test("partial/error/aborted assistants are excluded from model context as a unit without orphan results", () => {
		const aborted = assistantMessage(
			[
				{
					type: "toolCall",
					id: "call-x",
					name: "scan_resources",
					arguments: {},
				},
			],
			{ stopReason: "aborted", timestamp: 4 },
		);
		const partial = assistantMessage([{ type: "text", text: "partial" }], {
			stopReason: "error",
			errorMessage: "stream failed",
			timestamp: 5,
		});
		const records: SessionRecord[] = [
			messageRecord(1, userMessage("go")),
			messageRecord(2, aborted),
			messageRecord(3, toolResultMessage("call-x", "late result")),
			messageRecord(4, partial),
			messageRecord(5, userMessage("continue")),
			messageRecord(
				6,
				assistantMessage([{ type: "text", text: "recovered answer" }], {
					stopReason: "stop",
				}),
			),
		];
		const recovered = recoverSessionContext(records);
		// Excluded as a unit: the aborted assistant and its late result never reach the model.
		expect(recovered.modelContext.map((message) => message.role)).toEqual([
			"user",
			"user",
			"assistant",
		]);
		expect(toolCallIds(asMessages(recovered.modelContext))).toEqual([]);
		expect(toolResultIds(asMessages(recovered.modelContext))).toEqual([]);
		// Interrupted messages remain in display history.
		expect(
			recovered.history.filter((entry) => entry.kind === "message"),
		).toHaveLength(6);

		// The actual provider's payload conversion must not need to insert its synthetic
		// "No result provided" filler for anything in the recovered model context.
		const transformed = transformMessages(
			asMessages(recovered.modelContext),
			fakeBedrockModel,
		);
		const synthetic = transformed.filter(
			(message) =>
				message.role === "toolResult" &&
				message.content.some(
					(block) =>
						block.type === "text" && block.text === "No result provided",
				),
		);
		expect(synthetic).toHaveLength(0);
	});

	test("interrupted display entries stay out of the model context", () => {
		const records: SessionRecord[] = [
			messageRecord(1, userMessage("hi")),
			{
				v: SESSION_RECORD_VERSION,
				kind: "interrupted",
				seq: 2,
				timestamp: 2,
				reason: "stream_interrupted",
				text: "partial assistant text",
			},
			messageRecord(
				3,
				assistantMessage([{ type: "text", text: "complete" }], {
					stopReason: "stop",
				}),
			),
		];
		const recovered = recoverSessionContext(records);
		expect(recovered.modelContext.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(
			recovered.history.some((entry) => entry.kind === "interrupted"),
		).toBe(true);
	});
});

describe("session store files and locking", () => {
	let root: string;
	let project: string;
	let directory: string;
	let sessions: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-session-store-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		sessions = join(directory, "sessions");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	function metadata(sessionId: string): SessionMetadata {
		return { sessionId, projectPath: project, identity, model };
	}

	test("creates private 0600 records, 0700 directories and a version-1 header", async () => {
		const store = await createSessionStore(metadata("s1"));
		await store.recordMessage(userMessage("hello"));
		const file = join(sessions, "s1.jsonl");
		expect((await lstat(file)).mode & 0o777).toBe(0o600);
		expect((await lstat(sessions)).mode & 0o777).toBe(0o700);
		const contents = await readFile(file, "utf8");
		expect(contents.split("\n")[0]).toContain('"kind":"header"');
		const parsed = await readSessionLog(file);
		expect(parsed.header.sessionId).toBe("s1");
		expect(parsed.header.v).toBe(SESSION_RECORD_VERSION);
		expect(parsed.header.codec).toBe(CODEC_VERSION);
		expect(parsed.header.identity.accountId).toBe(identity.accountId);
		await store.close();
	});

	test("records stay 0600 and append through one FIFO queue", async () => {
		const store = await createSessionStore(metadata("fifo"));
		await store.recordMessage(userMessage("first"));
		const pending = [
			store.recordMessage(userMessage("second")),
			store.recordMessage(userMessage("third")),
		];
		await Promise.all(pending);
		const file = join(sessions, "fifo.jsonl");
		expect((await lstat(file)).mode & 0o777).toBe(0o600);
		expect(
			await readSessionLog(file).then((parsed) =>
				parsed.records.map((record) =>
					record.kind === "message" && record.message.role === "user"
						? record.message.content
						: "",
				),
			),
		).toEqual(["first", "second", "third"]);
		await store.close();
	});

	test("a second writer is refused with the lock path and owner while locked", async () => {
		const store = await createSessionStore(metadata("locked"));
		try {
			await expect(createSessionStore(metadata("locked"))).rejects.toThrow(
				/locked/i,
			);
			await expect(openSessionStore(metadata("locked"))).rejects.toThrow(
				/locked/i,
			);
			const lockPath = join(sessions, "locked.jsonl.lock");
			const failure: unknown = await openSessionStore(metadata("locked")).then(
				() => null,
				(value) => value,
			);
			if (!(failure instanceof Error)) throw new Error("Expected lock refusal");
			expect(failure.message).toContain(lockPath);
			expect(failure.message).toContain(String(process.pid));
			// The lock file itself is private.
			expect((await lstat(lockPath)).mode & 0o777).toBe(0o600);
		} finally {
			await store.close();
		}
	});

	test("operator-confirmed cleanup recovers the session after all owners stop", async () => {
		const first = await createSessionStore(metadata("resumed"));
		await first.recordMessage(userMessage("before restart"));
		await first.close();

		// Simulate a crashed owner that left its lock behind.
		const lockPath = join(sessions, "resumed.jsonl.lock");
		await writeFile(
			lockPath,
			JSON.stringify({ pid: 999999, nonce: "stale", createdAt: 1 }),
			{ flag: "wx" },
		);
		await expect(openSessionStore(metadata("resumed"))).rejects.toThrow(
			/locked/i,
		);

		// Operator-confirmed cleanup (no automatic deletion anywhere in the store).
		await unlink(lockPath);
		const reopened = await openSessionStore(metadata("resumed"));
		await reopened.recordMessage(userMessage("after restart"));
		await reopened.close();

		const parsed = await readSessionLog(join(sessions, "resumed.jsonl"));
		expect(
			parsed.records.map((record) =>
				record.kind === "message" && record.message.role === "user"
					? record.message.content
					: "",
			),
		).toEqual(["before restart", "after restart"]);
		// Sequence continues across the restart.
		expect(parsed.records.map((record) => record.seq)).toEqual([1, 2]);
	});

	test("stale or foreign locks are treated conservatively, never deleted automatically", async () => {
		await mkdir(sessions, { recursive: true });
		const lockPath = join(sessions, "stale.jsonl.lock");
		for (const content of [
			JSON.stringify({ pid: process.pid, nonce: "someone-else", createdAt: 1 }),
			"garbage",
			"",
		]) {
			await writeFile(lockPath, content, { flag: "wx" });
			try {
				await expect(openSessionStore(metadata("stale"))).rejects.toThrow(
					/locked/i,
				);
				expect(await readdir(sessions)).toContain("stale.jsonl.lock");
			} finally {
				await unlink(lockPath);
			}
		}
	});

	test("project, account and region metadata are immutable across resumes", async () => {
		const store = await createSessionStore(metadata("bound"));
		await store.close();
		await expect(
			openSessionStore({
				sessionId: "bound",
				projectPath: project,
				identity: { ...identity, accountId: "999999999999" },
				model,
			}),
		).rejects.toThrow(/account/i);
		await expect(
			openSessionStore({
				sessionId: "bound",
				projectPath: join(project, "other"),
				identity,
				model,
			}),
		).rejects.toThrow(/project/i);
		await expect(
			openSessionStore({
				sessionId: "bound",
				projectPath: project,
				identity: { ...identity, region: "us-east-1" },
				model,
			}),
		).rejects.toThrow(/region/i);
	});

	test("an existing session cannot be recreated and an unknown format is rejected", async () => {
		const store = await createSessionStore(metadata("dup"));
		await store.close();
		await expect(createSessionStore(metadata("dup"))).rejects.toThrow(
			/exists/i,
		);

		await writeFile(join(sessions, "alien.jsonl"), "some other format\n", {
			flag: "wx",
		});
		await expect(openSessionStore(metadata("alien"))).rejects.toThrow(
			/format|header/i,
		);
	});

	test("loading a session calls neither provider nor executor", async () => {
		const store = await createSessionStore(metadata("readonly"));
		await store.recordMessage(userMessage("history"));
		await store.close();
		// readSessionLog is a pure filesystem read: it never constructs agents,
		// streams, executors or approvals. Assert the recovered context shape.
		const parsed = await readSessionLog(join(sessions, "readonly.jsonl"));
		const recovered = recoverSessionContext(parsed.records);
		expect(recovered.modelContext).toHaveLength(1);
		expect(recovered.history).toHaveLength(1);
	});

	test("write failure before intent fails closed before the side effect", async () => {
		// The record handle is opened once at store construction, so permission
		// changes after that do not affect an open fd; failure injection uses the
		// openHandle seam instead.
		const injected = failingOpenHandle();
		const store = await createSessionStore(metadata("preintent"), injected);
		await store.recordMessage(userMessage("warmup"));
		injected.failNext();
		await expect(
			store.recordToolIntent({
				toolCallId: "call-1",
				toolName: "deploy_infra",
				digest: createHash("sha256").update("args").digest("hex"),
			}),
		).rejects.toThrow(/injected write failure/i);
		// The side effect caller pattern: the synced intent must have settled
		// before execution; the failed intent never settles.
		await expect(store.recordMessage(userMessage("never"))).rejects.toThrow();
		await store.close();

		// A healthy store resolves the synced intent before any side effect runs.
		const healthy = await openSessionStore(metadata("preintent"));
		let executed = false;
		await healthy
			.recordToolIntent({
				toolCallId: "call-2",
				toolName: "deploy_infra",
				digest: createHash("sha256").update("args2").digest("hex"),
			})
			.then(() => {
				executed = true;
			});
		expect(executed).toBe(true);
		await healthy.close();
	});

	test("toolIntentDigest round-trips through recordToolIntent", async () => {
		const digest = toolIntentDigest({ region: "eu-central-1" });
		const store = await createSessionStore(metadata("intent"));
		await expect(
			store.recordToolIntent({
				toolCallId: "call-1",
				toolName: "scan_resources",
				digest,
			}),
		).resolves.toBeUndefined();
		await store.close();
		const parsed = await readSessionLog(join(sessions, "intent.jsonl"));
		const intent = parsed.records.find(
			(record) => record.kind === "tool_intent",
		);
		if (intent?.kind !== "tool_intent") throw new Error("Expected tool_intent");
		expect(intent.digest).toBe(digest);
	});

	test("a rejected record never advances the sequence, so no silent gap can occur", async () => {
		const store = await createSessionStore(metadata("gapless"));
		await store.recordMessage(userMessage("first"));
		await expect(store.recordMessage({ role: "nope" })).rejects.toThrow();
		// The next valid record must take the freed sequence: no gap, or every
		// future openSessionStore would fail closed and silently lose the session.
		await store.recordMessage(userMessage("second"));
		await store.close();
		const reopened = await openSessionStore(metadata("gapless"));
		const parsed = await readSessionLog(join(sessions, "gapless.jsonl"));
		expect(parsed.records.map((record) => record.seq)).toEqual([1, 2]);
		await reopened.close();
	});

	test("failed result persistence poisons the store and marks the outcome uncertain", async () => {
		const injected = failingOpenHandle();
		const store = await createSessionStore(metadata("poison"), injected);
		await store.recordMessage(userMessage("go"));
		injected.failNext();
		await expect(
			store.recordMessage(toolResultMessage("call-1", "result after exec")),
		).rejects.toThrow(/injected write failure/i);
		expect(store.uncertain).toBe(true);
		// No automatic retry: further persistence fails closed.
		await expect(store.recordMessage(userMessage("never"))).rejects.toThrow();
		await store.close();
	});

	test("reopening after a discarded tail truncates the uncommitted tail and stays parseable", async () => {
		const store = await createSessionStore(metadata("tail"));
		await store.recordMessage(userMessage("committed"));
		await store.close();
		// Simulate a crash mid-write: a partial, unterminated record line.
		const file = join(sessions, "tail.jsonl");
		await writeFile(file, '{"v":1,"kind":"mess', { flag: "a" });
		// The reopen must not append onto the partial bytes: the new JSONL line
		// would concatenate into a corrupt terminated middle line.
		const reopened = await openSessionStore(metadata("tail"));
		await reopened.recordMessage(userMessage("after crash"));
		await reopened.close();
		const parsed = await readSessionLog(file);
		expect(parsed.tailDiscarded).toBe(false);
		expect(
			parsed.records.map((record) =>
				record.kind === "message" && record.message.role === "user"
					? record.message.content
					: "",
			),
		).toEqual(["committed", "after crash"]);
		// And the session remains openable.
		const third = await openSessionStore(metadata("tail"));
		await third.close();
	});

	test("a record-open failure after lock acquisition closes every opened handle", async () => {
		const failRecordOpen = true;
		const opened: string[] = [];
		const closed: string[] = [];
		await expect(
			createSessionStore(metadata("leaked"), {
				openHandle: async (path, flag, mode) => {
					if (path.endsWith(".jsonl") && failRecordOpen) {
						throw new Error("injected record-open failure");
					}
					const real = await realOpenHandle(path, flag, mode);
					opened.push(path);
					return {
						appendLine: (line: string) => real.appendLine(line),
						sync: () => real.sync(),
						close: async () => {
							closed.push(path);
							await real.close();
						},
					};
				},
			}),
		).rejects.toThrow(/injected record-open failure/i);
		// The store must release the lock file and close every handle it opened.
		expect(await readdir(sessions)).not.toContain("leaked.jsonl.lock");
		expect(closed).toEqual(opened);
		// The lock is gone: a healthy open of the same session succeeds.
		const healthy = await createSessionStore(metadata("leaked"));
		await healthy.close();
	});

	test("a record-close failure still releases the lock and throws typed SessionStoreError", async () => {
		let failRecordClose = true;
		const store = await createSessionStore(metadata("closefail"), {
			openHandle: async (path, flag, mode) => {
				const real = await realOpenHandle(path, flag, mode);
				return {
					appendLine: (line: string) => real.appendLine(line),
					sync: () => real.sync(),
					close: async () => {
						if (path.endsWith(".jsonl") && failRecordClose) {
							failRecordClose = false;
							// Simulate a failure reported after the close attempt:
							// release the real fd, then surface the error.
							await real.close();
							throw new Error("injected record-close failure");
						}
						await real.close();
					},
				};
			},
		});
		const failure: unknown = await store.close().then(
			() => null,
			(value) => value,
		);
		if (!(failure instanceof Error)) throw new Error("Expected close failure");
		expect(failure).toBeInstanceOf(SessionStoreError);
		expect(failure.message).toContain(join(sessions, "closefail.jsonl"));
		// Cleanup still ran: the lock is released and the session is reusable.
		expect(await readdir(sessions)).not.toContain("closefail.jsonl.lock");
		const healthy = await openSessionStore(metadata("closefail"));
		await healthy.recordMessage(userMessage("usable again"));
		await healthy.close();
	});

	test("refuses a symlinked session record file without following it", async () => {
		await mkdir(sessions, { recursive: true });
		await writeFile(join(root, "outside.jsonl"), "outside bytes");
		await symlink(join(root, "outside.jsonl"), join(sessions, "sym.jsonl"));
		await expect(createSessionStore(metadata("sym"))).rejects.toThrow(
			/symbolic link/i,
		);
		// The link target is untouched and the lock is not left behind.
		expect(await readFile(join(root, "outside.jsonl"), "utf8")).toBe(
			"outside bytes",
		);
		expect(await readdir(sessions)).not.toContain("sym.jsonl.lock");
	});
});
