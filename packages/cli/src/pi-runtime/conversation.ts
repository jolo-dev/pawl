import { z } from "zod";

/**
 * The Pawl-owned conversation boundary between the embedded Pi runtime and the
 * UI. Pi's event/input unions never leak through this file: every event and
 * answer here is a Zod schema, and anything a provider or vendor emits that
 * does not match one of them fails closed (`parseConversationEvent` returns
 * null) instead of being translated into a request or approval.
 *
 * Ordering/error semantics that Task 10's Pi-backed implementation must honor:
 *
 * - `send` accepts and persists the input and returns its run id immediately;
 *   it never awaits model completion. While a run is active the input is
 *   queued in memory only, bounded by `QUEUED_PROMPT_LIMIT` (excess is a
 *   visible rejection). Queued prompts are discarded on cancel/dispose/restart.
 * - A single event consumer must subscribe via `events()` before the first
 *   send. Exactly one terminal event per run is produced after cleanup and
 *   checkpoint settlement; Pi's inner `turn_end` is one model iteration and is
 *   never an application terminal event. An input request does not end a run.
 * - `answer` delivers a one-use answer for a live pending request; stale,
 *   unknown or cancelled requests reject. Abort and shutdown settle pending
 *   input requests.
 * - `cancel` cancels the given run, or everything active when no run id is
 *   given (settling pending requests and discarding queued prompts).
 * - `dispose` is idempotent; late events after disposal are not delivered.
 */

/**
 * Fixed proof default from the plan (Task 6's policy object owns budgets; the
 * queue bound is enforced here so Task 6 can import this constant).
 */
export const QUEUED_PROMPT_LIMIT = 8;

const RunId = z.string().min(1);

/**
 * A question or approval offered to the human. Empty `options` is a freeform
 * question; non-empty options resolve by number or option id. A request never
 * implies authorization by itself — questions do not grant approvals.
 */
export const PawlInputRequestSchema = z.strictObject({
	requestId: z.string().min(1),
	prompt: z.string(),
	options: z.array(
		z.strictObject({ id: z.string().min(1), label: z.string() }),
	),
});
export type PawlInputRequest = z.infer<typeof PawlInputRequestSchema>;

export const PawlAnswerSchema = z.strictObject({
	requestId: z.string().min(1),
	choice: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("option"), value: z.string().min(1) }),
		z.strictObject({ kind: z.literal("text"), value: z.string() }),
	]),
});
export type PawlAnswer = z.infer<typeof PawlAnswerSchema>;

export const PawlConversationEventSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("user_message"),
		runId: RunId,
		text: z.string(),
		queued: z.boolean(),
	}),
	z.strictObject({ type: z.literal("run_started"), runId: RunId }),
	z.strictObject({
		type: z.literal("text_delta"),
		runId: RunId,
		delta: z.string(),
	}),
	z.strictObject({
		type: z.literal("reasoning_delta"),
		runId: RunId,
		delta: z.string(),
	}),
	z.strictObject({ type: z.literal("message_end"), runId: RunId }),
	z.strictObject({
		type: z.literal("tool_started"),
		runId: RunId,
		toolCallId: z.string().min(1),
		toolName: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("tool_update"),
		runId: RunId,
		toolCallId: z.string().min(1),
		text: z.string(),
	}),
	z.strictObject({
		type: z.literal("tool_result"),
		runId: RunId,
		toolCallId: z.string().min(1),
		toolName: z.string().min(1).optional(),
		status: z.enum(["completed", "error"]),
		text: z.string().optional(),
	}),
	z.strictObject({
		type: z.literal("input_requested"),
		runId: RunId,
		request: PawlInputRequestSchema,
	}),
	z.strictObject({
		type: z.literal("input_resolved"),
		runId: RunId,
		requestId: z.string().min(1),
	}),
	z.strictObject({ type: z.literal("prompt_discarded"), runId: RunId }),
	z.strictObject({
		type: z.literal("run_terminal"),
		runId: RunId,
		outcome: z.enum(["completed", "cancelled", "failed"]),
		code: z.string().optional(),
		message: z.string().optional(),
	}),
]);
export type PawlConversationEvent = z.infer<typeof PawlConversationEventSchema>;

/**
 * Parses one raw event against the owned union. Unknown vendor events return
 * null and must be dropped — never surfaced as approval requests.
 */
export function parseConversationEvent(
	event: unknown,
): PawlConversationEvent | null {
	const parsed = PawlConversationEventSchema.safeParse(event);
	return parsed.success ? parsed.data : null;
}

export interface PawlConversation {
	readonly id: string;
	/** Accepts/persists the input; does not await model completion. */
	send(text: string): Promise<{ runId: string }>;
	/** Delivers a one-use answer for a live pending input request. */
	answer(answer: PawlAnswer): Promise<void>;
	/** Cancels the given run, or everything active when omitted. */
	cancel(runId?: string): Promise<void>;
	/** Single consumer; must be subscribed before the first send. */
	events(): AsyncIterable<PawlConversationEvent>;
	dispose(): Promise<void>;
}
