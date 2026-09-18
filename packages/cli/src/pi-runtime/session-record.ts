import { z } from "zod";
import { stableStringify } from "./approval";

/**
 * Version-1 session record codec for the Pi runtime proof.
 *
 * A session log is JSONL: one header line followed by strictly sequenced
 * records. The header pins the codec version to the installed
 * @earendil-works/pi-ai 0.85.1 message shapes and stores the session id,
 * project path, checked AWS identity (account/region/principal), model and
 * creation time. These metadata are immutable for the life of the log. Later
 * records carry a monotonic sequence starting at 1 and their own write
 * timestamp.
 *
 * Runtime metadata is strict (unknown fields rejected), so SDK credential
 * objects, environment dumps or tokens cannot be recorded. No raw provider
 * configuration is stored anywhere: the model is recorded as id/name only.
 *
 * Messages are validated against the installed Pi message shapes; known
 * opaque provider fields (thinking/thought signatures, response ids, deferred
 * handles, diagnostics, usage) survive round-trips byte-for-byte and are
 * never normalized.
 *
 * Transcript sensitivity: records contain the whole conversation, including
 * whatever the human typed. A user message that merely resembles a secret is
 * legitimate content and is never rejected; private permissions and Git
 * exclusion do not make transcripts safe to share.
 */

export const SESSION_RECORD_VERSION = 1;
/** Pinned to the installed @earendil-works/pi-ai message shapes (0.85.1). */
export const CODEC_VERSION = 1;

// ---- Header ----

export const SessionIdentitySchema = z.strictObject({
	accountId: z.string().regex(/^\d{12}$/),
	region: z.string().min(1),
	principalArn: z.string().min(1),
});

export const SessionHeaderSchema = z.strictObject({
	v: z.literal(SESSION_RECORD_VERSION),
	kind: z.literal("header"),
	codec: z.literal(CODEC_VERSION),
	sessionId: z.string().min(1),
	projectPath: z.string().min(1),
	identity: SessionIdentitySchema,
	model: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
	createdAt: z.number(),
});

export type SessionIdentity = z.infer<typeof SessionIdentitySchema>;
export type SessionHeader = z.infer<typeof SessionHeaderSchema>;

// ---- Message content (installed pi-ai 0.85.1 shapes) ----

const textContentSchema = z.strictObject({
	type: z.literal("text"),
	text: z.string(),
	textSignature: z.string().optional(),
});

const thinkingContentSchema = z.strictObject({
	type: z.literal("thinking"),
	thinking: z.string(),
	thinkingSignature: z.string().optional(),
	redacted: z.boolean().optional(),
});

const imageContentSchema = z.strictObject({
	type: z.literal("image"),
	data: z.string(),
	mimeType: z.string(),
});

const toolCallContentSchema = z.strictObject({
	type: z.literal("toolCall"),
	id: z.string().min(1),
	name: z.string().min(1),
	arguments: z.record(z.string(), z.unknown()),
	thoughtSignature: z.string().optional(),
	namespace: z.string().optional(),
});

const usageSchema = z.strictObject({
	input: z.number(),
	output: z.number(),
	cacheRead: z.number(),
	cacheWrite: z.number(),
	cacheWrite1h: z.number().optional(),
	reasoning: z.number().optional(),
	totalTokens: z.number(),
	cost: z.strictObject({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number(),
		total: z.number(),
	}),
});

const diagnosticSchema = z.strictObject({
	type: z.string(),
	timestamp: z.number(),
	error: z
		.strictObject({
			name: z.string().optional(),
			message: z.string(),
			stack: z.string().optional(),
			code: z.union([z.string(), z.number()]).optional(),
		})
		.optional(),
	details: z.record(z.string(), z.unknown()).optional(),
});

const deferredHandleSchema = z.strictObject({
	provider: z.string(),
	modelId: z.string(),
	api: z.string(),
	id: z.string(),
	expiresAt: z.number().optional(),
	pollAfterMs: z.number().optional(),
	data: z.unknown().optional(),
});

const assistantMessageSchema = z.strictObject({
	role: z.literal("assistant"),
	content: z.array(
		z.union([textContentSchema, thinkingContentSchema, toolCallContentSchema]),
	),
	api: z.string(),
	provider: z.string(),
	model: z.string(),
	responseModel: z.string().optional(),
	responseId: z.string().optional(),
	providerThinkingLevel: z.string().optional(),
	diagnostics: z.array(diagnosticSchema).optional(),
	usage: usageSchema,
	stopReason: z.enum([
		"pending",
		"stop",
		"length",
		"toolUse",
		"error",
		"aborted",
		"deferred",
	]),
	deferred: deferredHandleSchema.optional(),
	errorMessage: z.string().optional(),
	rawStopReason: z.string().optional(),
	endTurn: z.boolean().optional(),
	timestamp: z.number(),
});

const toolResultMessageSchema = z.strictObject({
	role: z.literal("toolResult"),
	toolCallId: z.string().min(1),
	toolName: z.string().min(1),
	content: z.array(z.union([textContentSchema, imageContentSchema])),
	details: z.unknown().optional(),
	usage: usageSchema.optional(),
	addedToolNames: z.array(z.string()).optional(),
	isError: z.boolean(),
	timestamp: z.number(),
});

export const SessionMessageSchema = z.discriminatedUnion("role", [
	z.strictObject({
		role: z.literal("user"),
		content: z.union([
			z.string(),
			z.array(z.union([textContentSchema, imageContentSchema])),
		]),
		timestamp: z.number(),
	}),
	assistantMessageSchema,
	toolResultMessageSchema,
]);

export type SessionMessage = z.infer<typeof SessionMessageSchema>;

// ---- Records ----

const seqSchema = z.number().int().min(1);

const messageRecordSchema = z.strictObject({
	v: z.literal(SESSION_RECORD_VERSION),
	kind: z.literal("message"),
	seq: seqSchema,
	timestamp: z.number(),
	message: SessionMessageSchema,
});

const toolIntentRecordSchema = z.strictObject({
	v: z.literal(SESSION_RECORD_VERSION),
	kind: z.literal("tool_intent"),
	seq: seqSchema,
	timestamp: z.number(),
	toolCallId: z.string().min(1),
	toolName: z.string().min(1),
	/** Digest over the canonical tool arguments. The arguments themselves live
	 * in the assistant message record and are never re-dumped here. */
	digest: z.string().regex(/^[0-9a-f]{64}$/),
});

const interruptedRecordSchema = z.strictObject({
	v: z.literal(SESSION_RECORD_VERSION),
	kind: z.literal("interrupted"),
	seq: seqSchema,
	timestamp: z.number(),
	/** Machine-readable interruption cause, for example "stream_interrupted". */
	reason: z.string().min(1),
	/** Display-only partial text; never becomes a fabricated complete message. */
	text: z.string(),
});

export const SessionRecordSchema = z.discriminatedUnion("kind", [
	messageRecordSchema,
	toolIntentRecordSchema,
	interruptedRecordSchema,
]);

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

// ---- Encoding ----

export class SessionRecordError extends Error {}

export function encodeHeaderLine(header: SessionHeader): string {
	const parsed = SessionHeaderSchema.safeParse(header);
	if (!parsed.success) {
		throw new SessionRecordError(
			"Session header was invalid; refusing to record it",
		);
	}
	return JSON.stringify(parsed.data);
}

export function encodeRecordLine(record: SessionRecord): string {
	const parsed = SessionRecordSchema.safeParse(record);
	if (!parsed.success) {
		throw new SessionRecordError(
			"Session record was invalid; refusing to record it",
		);
	}
	return JSON.stringify(parsed.data);
}

/** Digest over the canonical JSON of tool arguments (stable stringify). */
export function toolIntentDigest(input: unknown): string {
	return stableStringify(input);
}

// ---- Decoding (fail closed) ----

export interface ParsedSessionLog {
	readonly header: SessionHeader;
	readonly records: readonly SessionRecord[];
	/** True when a trailing unterminated line was conservatively discarded. */
	readonly tailDiscarded: boolean;
}

/**
 * Parses a complete JSONL session log. One header line must come first; every
 * later terminated line must be a valid record with a monotonic sequence
 * starting at 1. A trailing unterminated line is treated as an uncommitted
 * tail and discarded; any terminated invalid record or sequence gap fails
 * closed. Error messages carry line numbers, never record contents.
 */
export function parseSessionLog(text: string): ParsedSessionLog {
	const terminated = text.endsWith("\n");
	const rawLines = text.split("\n").filter((line) => line.length > 0);
	const tailDiscarded = !terminated && rawLines.length > 0;
	const lines = tailDiscarded ? rawLines.slice(0, -1) : rawLines;
	if (lines.length === 0) {
		throw new SessionRecordError(
			"Session log has no complete records; the format is unrecognized",
		);
	}
	const header = parseHeader(lines[0] ?? "");
	const records: SessionRecord[] = [];
	let expectedSeq = 1;
	for (let index = 1; index < lines.length; index++) {
		const lineNumber = index + 1;
		const record = parseRecord(lines[index] ?? "", lineNumber);
		if (record.seq !== expectedSeq) {
			throw new SessionRecordError(
				`Session log has a sequence gap at line ${lineNumber}: expected ${expectedSeq}, found ${record.seq}`,
			);
		}
		expectedSeq = record.seq + 1;
		records.push(record);
	}
	return { header, records, tailDiscarded };
}

function parseHeader(line: string): SessionHeader {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new SessionRecordError(
			"Session log does not start with a valid JSON header; the format is unrecognized",
		);
	}
	const result = SessionHeaderSchema.safeParse(parsed);
	if (!result.success) {
		throw new SessionRecordError(
			"Session log header does not match the version-1 schema; the format is unsupported",
		);
	}
	return result.data;
}

function parseRecord(line: string, lineNumber: number): SessionRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new SessionRecordError(
			`Session log line ${lineNumber} is corrupt; failing closed instead of discarding it`,
		);
	}
	const result = SessionRecordSchema.safeParse(parsed);
	if (!result.success) {
		throw new SessionRecordError(
			`Session log line ${lineNumber} does not match the version-1 record schema; failing closed instead of discarding it`,
		);
	}
	return result.data;
}

// ---- Recovery ----

export type RecoveredHistoryEntry =
	| { readonly kind: "message"; readonly message: SessionMessage }
	| {
			readonly kind: "interrupted";
			readonly reason: string;
			readonly text: string;
	  };

export interface RecoveredSessionContext {
	/**
	 * Validated messages forming valid tool-call/result groups for model
	 * context. Complete assistant tool calls keep their recorded results and
	 * missing results are filled with explicit interrupted/unknown-outcome
	 * notices. Partial/error/aborted assistants and their results are excluded
	 * as a unit. Recovery happens in memory; the on-disk log is never rewritten.
	 */
	readonly modelContext: SessionMessage[];
	/** Complete history including interrupted entries, for display. */
	readonly history: readonly RecoveredHistoryEntry[];
}

const interruptedNoticeBase =
	"[pawl: interrupted — this tool result was never recorded; its outcome is unknown]";

/**
 * Recovers model context and display history from decoded records.
 * Pure function: it calls neither provider nor executor and never revives an
 * approval (approval grants are never recorded, so none can be restored).
 */
export function recoverSessionContext(
	records: readonly SessionRecord[],
): RecoveredSessionContext {
	const history: RecoveredHistoryEntry[] = [];
	const messages: SessionMessage[] = [];
	for (const record of records) {
		if (record.kind === "message") {
			history.push({ kind: "message", message: record.message });
			messages.push(record.message);
		} else if (record.kind === "interrupted") {
			history.push({
				kind: "interrupted",
				reason: record.reason,
				text: record.text,
			});
		}
		// tool_intent records carry execution intent only; they are neither
		// model context nor display history.
	}

	const modelContext: SessionMessage[] = [];
	/** Unresolved tool calls of the latest included completed assistant. */
	let pending = new Map<string, { readonly toolName: string }>();

	/**
	 * Closes the pending group: completed results stay in place and only
	 * missing ones are filled, immediately after the last recorded result.
	 */
	const fillPending = () => {
		for (const [toolCallId, call] of pending) {
			modelContext.push({
				role: "toolResult",
				toolCallId,
				toolName: call.toolName,
				content: [
					{
						type: "text",
						text: `${interruptedNoticeBase} (tool call ${toolCallId})`,
					},
				],
				isError: true,
				timestamp: Date.now(),
			});
		}
		pending = new Map();
	};

	for (const message of messages) {
		if (message.role === "assistant") {
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				// Pi's provider conversion removes these messages entirely: the
				// incomplete group is excluded from model context as a unit, and
				// no orphan synthetic result is attached to it. Pending results
				// of an earlier completed assistant stay open until their real
				// results arrive.
				continue;
			}
			fillPending();
			pending = new Map(
				message.content
					.filter((block) => block.type === "toolCall")
					.map((block) => [block.id, { toolName: block.name }]),
			);
			modelContext.push(message);
			continue;
		}
		if (message.role === "toolResult") {
			if (pending.has(message.toolCallId)) {
				pending.delete(message.toolCallId);
				modelContext.push(message);
			}
			// Orphan results (no pending included assistant call) are excluded
			// from model context but kept in display history.
			continue;
		}
		// A user message interrupts the tool flow: fill pending results first.
		fillPending();
		modelContext.push(message);
	}
	fillPending();

	return { modelContext, history };
}
