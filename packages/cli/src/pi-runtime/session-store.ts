import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, open, readFile, truncate, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
	ensurePawlSubdirectory,
	protectPawlLocalFiles,
} from "../pawl-local-files";
import {
	CODEC_VERSION,
	encodeHeaderLine,
	encodeRecordLine,
	parseSessionLog,
	SESSION_RECORD_VERSION,
	type SessionHeader,
	SessionIdentitySchema,
	type SessionRecord,
} from "./session-record";

/**
 * Durable, private, resumable session records for the Pi runtime proof.
 *
 * One writer per session: the store holds an exclusive `wx` lock file
 * (`<sessionId>.jsonl.lock`, mode 0600, owner PID/nonce inside). A refused
 * writer reports the lock path and recorded owner. There is NO automatic
 * stale-lock deletion in this proof: recovery requires operator-confirmed
 * cleanup after all owners have stopped. This deliberate limitation must
 * appear in the proof report, not be hidden as seamless crash recovery.
 *
 * Records are appended through one FIFO queue; a checkpoint promise settles
 * only after the record is written and fsynced. Complete tool intent uses the
 * same awaited path, so a caller can sync intent before allowing a side
 * effect. If a write fails before intent, the side effect must not start; if
 * it fails after an execution, the store becomes uncertain and poisoned: the
 * outcome is unknown/interrupted, further persistence fails closed, and
 * nothing is retried automatically.
 *
 * Project path, account and region are immutable metadata: reopening a
 * session with different values is explained instead of silently re-attaching
 * the old conversation to a new target.
 *
 * Sequence policy: a record's sequence is assigned and the counter advances
 * only after the record line encodes successfully. A record that fails schema
 * validation is rejected before the counter moves, so a rejected append can
 * never create a sequence gap (which would make every later reopen fail
 * closed). Only a write/fsync failure advances the counter, and that failure
 * poisons the store, so an advanced sequence is always paired with a settled
 * (or failed) write, never silently skipped.
 *
 * Poison and concurrent appends: after a write/fsync failure the store is
 * poisoned, but records already queued behind the failed one may still be
 * persisted afterwards. The log can therefore contain records after a missing
 * failed record — an operator-intervention gap: the failed outcome is
 * unknown/interrupted, the caller must stop the run, and the gap must be
 * reported, not silently healed.
 *
 * Reopen policy: an unterminated final line is an uncommitted tail. On reopen
 * (while holding the exclusive lock) the store truncates the log to the last
 * committed newline before opening append mode, so a new JSONL line can never
 * concatenate onto partial tail bytes and corrupt the log. Read-only parsing
 * still discards the tail conservatively without touching the file.
 *
 * Cleanup policy: every close() and every buildStore error path runs all
 * cleanup best-effort (record handle, lock handle, lock release) before
 * surfacing a typed SessionStoreError; a failed record close never leaves the
 * lock behind.
 */

export class SessionStoreError extends Error {}

export class SessionLockError extends Error {
	readonly lockPath: string;

	constructor(message: string, lockPath: string) {
		super(message);
		this.name = "SessionLockError";
		this.lockPath = lockPath;
	}
}

export type SessionMetadata = {
	readonly sessionId: string;
	readonly projectPath: string;
	readonly identity: z.infer<typeof SessionIdentitySchema>;
	readonly model: { readonly id: string; readonly name: string };
};

const metadataSchema = z.strictObject({
	sessionId: z.string().min(1),
	projectPath: z.string().min(1),
	identity: SessionIdentitySchema,
	model: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
});

export interface SessionStoreDependencies {
	readonly now?: () => number;
	/** Handle seam for failure injection in tests; defaults to node fs. */
	readonly openHandle?: (
		path: string,
		flag: "a" | "wx",
		mode: number,
	) => Promise<SessionFileHandle>;
}

export interface SessionFileHandle {
	appendLine(line: string): Promise<void>;
	sync(): Promise<void>;
	close(): Promise<void>;
}

export interface SessionStore {
	readonly sessionId: string;
	readonly path: string;
	readonly header: SessionHeader;
	/** True once a failed write left an already-executed outcome uncertain. */
	readonly uncertain: boolean;
	/** Settles only after the message record is written and synced. */
	recordMessage(message: unknown): Promise<void>;
	/** Synced tool intent; await it before allowing any side effect. */
	recordToolIntent(intent: {
		toolCallId: string;
		toolName: string;
		digest: string;
	}): Promise<void>;
	recordInterrupted(entry: { reason: string; text: string }): Promise<void>;
	/** Releases the lock and closes the record. Idempotent. */
	close(): Promise<void>;
}

const intentSchema = z.strictObject({
	toolCallId: z.string().min(1),
	toolName: z.string().min(1),
	digest: z.string().regex(/^[0-9a-f]{64}$/),
});

const interruptedSchema = z.strictObject({
	reason: z.string().min(1),
	text: z.string(),
});

export function sessionFileName(sessionId: string): string {
	return `${sessionId}.jsonl`;
}

function lockFileName(sessionId: string): string {
	return `${sessionId}.jsonl.lock`;
}

/**
 * Reads a session log without locking, loading, executing or approving
 * anything: a pure filesystem read plus codec validation. It calls neither
 * provider nor executor and never revives an approval.
 */
export async function readSessionLog(path: string): Promise<{
	header: SessionHeader;
	records: readonly SessionRecord[];
	tailDiscarded: boolean;
}> {
	return parseSessionLog(await readFile(path, "utf8"));
}

async function readLockOwner(lockPath: string): Promise<string> {
	try {
		const parsed = JSON.parse(await readFile(lockPath, "utf8")) as {
			ownerPid?: unknown;
		};
		return typeof parsed.ownerPid === "number"
			? String(parsed.ownerPid)
			: "unknown";
	} catch {
		return "unknown";
	}
}

async function releaseLock(lockPath: string): Promise<void> {
	try {
		await unlink(lockPath);
	} catch (error) {
		if (
			!(error instanceof Error && "code" in error && error.code === "ENOENT")
		) {
			throw new SessionStoreError(
				`Could not release the session lock at ${lockPath}; remove it manually before reopening the session`,
				{ cause: error },
			);
		}
	}
}

/**
 * Creates a brand-new private session: private directories and ignore rules,
 * an exclusive lock, and a version-1 header written and synced as the first
 * line. Refuses when the session already exists or is locked.
 */
export async function createSessionStore(
	metadata: SessionMetadata,
	dependencies: SessionStoreDependencies = {},
): Promise<SessionStore> {
	return buildStore(metadataSchema.parse(metadata), dependencies, true);
}

/**
 * Reopens an existing session after validating the codec and the immutable
 * project/account/region metadata, takes the exclusive lock, and resumes the
 * sequence after the last complete record.
 */
export async function openSessionStore(
	metadata: SessionMetadata,
	dependencies: SessionStoreDependencies = {},
): Promise<SessionStore> {
	return buildStore(metadataSchema.parse(metadata), dependencies, false);
}

async function buildStore(
	metadata: z.infer<typeof metadataSchema>,
	dependencies: SessionStoreDependencies,
	create: boolean,
): Promise<SessionStore> {
	const now = dependencies.now ?? Date.now;
	const openHandle =
		dependencies.openHandle ??
		(async (path: string, flag: "a" | "wx", mode: number) => {
			const handle: FileHandle = await open(path, flag, mode);
			return {
				appendLine: async (line: string) => {
					await handle.appendFile(`${line}\n`, "utf8");
				},
				sync: () => handle.sync(),
				close: () => handle.close(),
			};
		});

	const pawlDirectory = resolve(metadata.projectPath, ".pawl");
	const sessionsDirectory = await ensurePawlSubdirectory(
		pawlDirectory,
		"sessions",
	);
	await protectPawlLocalFiles(pawlDirectory);
	const path = join(sessionsDirectory, sessionFileName(metadata.sessionId));
	const lockPath = join(sessionsDirectory, lockFileName(metadata.sessionId));

	// The record path is opened with flag "a", which follows a planted
	// symlink; inspect it with lstat first (consistent with the shared
	// helper's posture) and fail closed instead of redirecting session IO.
	let existingRecord: Stats | undefined;
	try {
		existingRecord = await lstat(path);
	} catch (error) {
		if (
			!(error instanceof Error && "code" in error && error.code === "ENOENT")
		) {
			throw new SessionStoreError(
				`Cannot inspect the session record path at ${path}. Check permissions and the path before retrying.`,
				{ cause: error },
			);
		}
	}
	if (existingRecord?.isSymbolicLink()) {
		throw new SessionStoreError(
			`Refusing symbolic link at ${path}. Remove or replace it with a project-local session record.`,
		);
	}
	if (create && existingRecord) {
		throw new SessionStoreError(
			`Session ${metadata.sessionId} already exists at ${path}; reopen it instead of recreating it`,
		);
	}

	// Exclusive lock: `wx` creation only, owner PID/nonce inside. Refusal is
	// actionable (lock path + owner) and never deletes the lock automatically.
	try {
		const created = await openHandle(lockPath, "wx", 0o600);
		// The existing file itself is the lock; the creation handle is closed
		// immediately and the store's own lock handle below keeps ownership.
		await created.close();
	} catch (error) {
		if (
			!(error instanceof Error && "code" in error && error.code === "EEXIST")
		) {
			throw new SessionStoreError(
				`Cannot create the session lock at ${lockPath}. Check permissions and the path before retrying.`,
				{ cause: error },
			);
		}
		throw new SessionLockError(
			`Session ${metadata.sessionId} is locked at ${lockPath}. The recorded owner PID is ${await readLockOwner(lockPath)}. Stop all owners, then remove the lock file to confirm operator cleanup`,
			lockPath,
		);
	}
	const lockHandle = await openHandle(lockPath, "a", 0o600);
	// From here on, this store owns the lock: every error path below must
	// release it and close every opened handle before surfacing.
	let handle: SessionFileHandle | undefined;
	try {
		const lock = {
			ownerPid: process.pid,
			nonce: randomUUID(),
			createdAt: now(),
		};
		await lockHandle.appendLine(JSON.stringify(lock));
		await lockHandle.sync();

		let header: SessionHeader;
		let nextSeq: number;
		if (create) {
			header = {
				v: SESSION_RECORD_VERSION,
				kind: "header",
				codec: CODEC_VERSION,
				sessionId: metadata.sessionId,
				projectPath: metadata.projectPath,
				identity: metadata.identity,
				model: metadata.model,
				createdAt: now(),
			};
			nextSeq = 1;
		} else {
			let contents: string;
			try {
				contents = await readFile(path, "utf8");
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				) {
					throw new SessionStoreError(
						`Session ${metadata.sessionId} does not exist at ${path}; create it instead of reopening it`,
						{ cause: error },
					);
				}
				throw error;
			}
			const parsed = parseSessionLog(contents);
			header = parsed.header;
			if (parsed.tailDiscarded) {
				// An unterminated final line is an uncommitted tail. Truncate to
				// the last committed newline (we hold the exclusive lock) so the
				// next append cannot concatenate onto the partial bytes.
				const committedLength = contents.lastIndexOf("\n") + 1;
				try {
					await truncate(path, committedLength);
				} catch (error) {
					throw new SessionStoreError(
						`Cannot discard the uncommitted tail of ${path}. Stop all writers, then repair or remove the partial final line manually before reopening`,
						{ cause: error },
					);
				}
			}
			const mismatches = [
				header.projectPath !== metadata.projectPath ? "project" : undefined,
				header.identity.accountId !== metadata.identity.accountId
					? "account"
					: undefined,
				header.identity.region !== metadata.identity.region
					? "region"
					: undefined,
			].filter((value): value is string => value !== undefined);
			if (mismatches.length > 0) {
				throw new SessionStoreError(
					`Session ${metadata.sessionId} was recorded for a different ${mismatches.join(" and ")}. Explain the mismatch and start a new conversation instead of silently re-attaching the old one to a new target`,
				);
			}
			nextSeq = parsed.records.length + 1;
		}

		handle = await openHandle(path, "a", 0o600);
		// A non-optional alias for the closures below (the cleanup path still
		// observes the optional outer binding).
		const recordHandle = handle;
		if (create) {
			await recordHandle.appendLine(encodeHeaderLine(header));
			await recordHandle.sync();
		}

		let uncertain = false;
		let poisonReason: string | undefined;
		/** FIFO queue: one record at a time, write + fsync before ack. */
		let tail: Promise<void> = Promise.resolve();
		let closed = false;

		async function appendRecord(
			record: Omit<SessionRecord, "seq">,
		): Promise<void> {
			if (closed) {
				throw new SessionStoreError("The session store is closed");
			}
			if (uncertain) {
				throw new SessionStoreError(
					`The session store is uncertain after a failed write (${poisonReason}); further persistence is refused and nothing is retried automatically`,
				);
			}
			// Encode first: a rejected record must not advance the sequence.
			const seq = nextSeq;
			const line = encodeRecordLine({ ...record, seq } as SessionRecord);
			nextSeq = seq + 1;
			const run = tail.then(async () => {
				await recordHandle.appendLine(line);
				await recordHandle.sync();
			});
			// The queue keeps draining past a failed record; this caller still
			// observes the failure and the store poisons itself.
			tail = run.then(
				() => undefined,
				() => undefined,
			);
			try {
				await run;
			} catch (error) {
				uncertain = true;
				poisonReason = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}

		return {
			sessionId: metadata.sessionId,
			path,
			header,
			get uncertain() {
				return uncertain;
			},
			recordMessage: (message) =>
				appendRecord({
					v: SESSION_RECORD_VERSION,
					kind: "message",
					timestamp: now(),
					message,
				} as SessionRecord),
			recordToolIntent: async (intent) => {
				const parsed = intentSchema.safeParse(intent);
				if (!parsed.success) {
					throw new SessionStoreError(
						"Tool intent was invalid; refusing to record it",
					);
				}
				await appendRecord({
					v: SESSION_RECORD_VERSION,
					kind: "tool_intent",
					timestamp: now(),
					...parsed.data,
				} as SessionRecord);
			},
			recordInterrupted: async (entry) => {
				const parsed = interruptedSchema.safeParse(entry);
				if (!parsed.success) {
					throw new SessionStoreError(
						"Interrupted entry was invalid; refusing to record it",
					);
				}
				await appendRecord({
					v: SESSION_RECORD_VERSION,
					kind: "interrupted",
					timestamp: now(),
					...parsed.data,
				} as SessionRecord);
			},
			close: async () => {
				if (closed) return;
				closed = true;
				// All cleanup runs best-effort: a failed record close must never
				// leave the lock behind or skip the remaining cleanup steps.
				const failures: unknown[] = [];
				try {
					await tail;
				} catch {
					// Already-observed queue failures must not mask close().
				}
				try {
					await recordHandle.close();
				} catch (error) {
					failures.push(error);
				}
				try {
					await lockHandle.close();
				} catch (error) {
					failures.push(error);
				}
				try {
					await releaseLock(lockPath);
				} catch (error) {
					failures.push(error);
				}
				if (failures.length > 0) {
					const cause = failures[0];
					throw new SessionStoreError(
						`Closing the session at ${path} failed (${cause instanceof Error ? cause.message : String(cause)}). The lock was still released; check the session files before reopening`,
						{ cause },
					);
				}
			},
		};
	} catch (error) {
		// Best-effort cleanup of every owned handle before releasing the lock;
		// double closes and release failures are swallowed here because the
		// original error is what must reach the caller.
		for (const owned of [handle, lockHandle]) {
			if (!owned) continue;
			try {
				await owned.close();
			} catch {
				// Already closed or failed: the lock release below still runs.
			}
		}
		await releaseLock(lockPath);
		throw error;
	}
}
