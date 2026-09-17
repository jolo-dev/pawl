import { describe, expect, test } from "bun:test";
import type {
	PawlAnswer,
	PawlConversation,
	PawlConversationEvent,
	PawlInputRequest,
} from "../src/pi-runtime/conversation";
import type { PawlConversationState } from "../src/pi-runtime/reducer";
import { createSessionDriver } from "../src/pi-runtime/session-driver";

/**
 * The driver routes user input and conversation events into the reducer. A
 * scripted conversation — not a Pi import — supplies the events so the routing
 * contract is tested without leaking vendor unions into this boundary.
 */

const approval: PawlInputRequest = {
	requestId: "r1",
	prompt: "Deploy PawlStack?",
	options: [
		{ id: "approve", label: "Approve" },
		{ id: "deny", label: "Deny" },
	],
};

const freeform: PawlInputRequest = {
	requestId: "q1",
	prompt: "What should the stack be named?",
	options: [],
};

class ScriptedConversation implements PawlConversation {
	readonly id = "conv_test";

	readonly #queue: PawlConversationEvent[] = [];
	#waiters: Array<(result: IteratorResult<PawlConversationEvent>) => void> = [];
	#tasks: Promise<unknown>[] = [];

	readonly sentPrompts: string[] = [];
	readonly answers: PawlAnswer[] = [];
	cancelCalls = 0;
	disposed = false;
	runCount = 0;
	/** When false, scripted runs stay open so callers can test busy behavior. */
	completesRuns = true;

	sendImpl?: (text: string, runId: string) => Promise<void>;
	answerImpl?: (answer: PawlAnswer) => Promise<void>;
	cancelImpl?: (runId?: string) => Promise<void>;

	push(event: PawlConversationEvent): void {
		this.#queue.push(event);
		this.#waiters.shift()?.({ value: event, done: false });
	}

	private async defaultRun(runId: string, text: string): Promise<void> {
		const queued = this.runCount > 1;
		this.push({ type: "user_message", runId, text, queued });
		// A queued prompt is not started yet; only the active run streams.
		if (queued) return;
		this.push({ type: "run_started", runId });
		this.push({ type: "text_delta", runId, delta: "Working…" });
		if (this.completesRuns) {
			this.push({ type: "run_terminal", runId, outcome: "completed" });
		}
	}

	send(text: string): Promise<{ runId: string }> {
		const runId = `run_${++this.runCount}`;
		const scripted =
			this.sendImpl?.(text, runId) ?? this.defaultRun(runId, text);
		this.#tasks.push(scripted.catch(() => {}));
		// The prompt counts as sent only once the conversation accepted it.
		return scripted.then(() => {
			this.sentPrompts.push(text);
			return { runId };
		});
	}

	async answer(answer: PawlAnswer): Promise<void> {
		await this.answerImpl?.(answer);
		this.answers.push(answer);
	}

	async cancel(runId?: string): Promise<void> {
		this.cancelCalls += 1;
		await this.cancelImpl?.(runId);
	}

	events(): AsyncIterable<PawlConversationEvent> {
		const self = this;
		async function* pump(): AsyncGenerator<PawlConversationEvent> {
			while (true) {
				const queued = self.#queue.shift();
				if (queued) {
					yield queued;
					continue;
				}
				if (self.disposed) return;
				const next = await new Promise<IteratorResult<PawlConversationEvent>>(
					(resolve) => {
						self.#waiters.push(resolve);
					},
				);
				if (next.done) return;
				yield next.value;
			}
		}
		return pump();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const waiter of this.#waiters.splice(0)) {
			waiter({ done: true } as IteratorResult<PawlConversationEvent>);
		}
	}
}

interface Harness {
	readonly conversation: ScriptedConversation;
	readonly driver: ReturnType<typeof createSessionDriver>;
	readonly states: PawlConversationState[];
	/** Resolves on the next driver state emission matching the predicate. */
	waitFor(predicate: (state: PawlConversationState) => boolean): Promise<void>;
}

function makeDriver(
	conversation?: ScriptedConversation,
	completesRuns = true,
): Harness {
	conversation ??= new ScriptedConversation();
	conversation.completesRuns = completesRuns;
	const states: PawlConversationState[] = [];
	const waiters: Array<{
		predicate: (state: PawlConversationState) => boolean;
		resolve: () => void;
	}> = [];
	const driver = createSessionDriver(conversation, {
		onState: (state) => {
			states.push(state);
			for (const [index, waiter] of waiters.entries()) {
				if (waiter.predicate(state)) {
					waiters.splice(index, 1);
					waiter.resolve();
				}
			}
		},
	});
	const waitFor = (predicate: (state: PawlConversationState) => boolean) => {
		if (predicate(driver.state)) return Promise.resolve();
		return new Promise<void>((resolve) => {
			waiters.push({ predicate, resolve });
		});
	};
	return { conversation, driver, states, waitFor };
}

async function openApprovalRun(
	harness: Harness,
	request: PawlInputRequest = approval,
): Promise<void> {
	harness.conversation.push({ type: "run_started", runId: "run_1" });
	harness.conversation.push({
		type: "input_requested",
		runId: "run_1",
		request,
	});
	await harness.waitFor((state) => state.awaitingInput);
}

describe("routing user input", () => {
	test("sends idle text to the conversation and echoes it once", async () => {
		const { driver, conversation, waitFor } = makeDriver();

		await driver.submit("scan the account");
		expect(conversation.sentPrompts).toEqual(["scan the account"]);
		await waitFor((state) => !state.busy);

		expect(driver.state.lines.filter((line) => line.role === "user")).toEqual([
			{ role: "user", text: "scan the account", open: false },
		]);
	});

	test("queues busy input through the conversation and discards it on cancel", async () => {
		const { driver, conversation, waitFor } = makeDriver(undefined, false);

		await driver.submit("first");
		await waitFor((state) => state.busy);
		await driver.submit("second");
		await waitFor((state) => state.queuedPrompts.length === 1);
		expect(driver.state.queuedPrompts).toEqual([
			{ runId: "run_2", text: "second" },
		]);
		// Queued input was accepted, not silently dropped.
		expect(conversation.sentPrompts).toEqual(["first", "second"]);

		conversation.push({ type: "prompt_discarded", runId: "run_2" });
		conversation.push({
			type: "run_terminal",
			runId: "run_1",
			outcome: "cancelled",
		});
		await waitFor((state) => !state.busy);

		expect(driver.state.queuedPrompts).toEqual([]);
		expect(
			driver.state.lines.some((line) =>
				line.text.includes("Discarded queued prompt: second"),
			),
		).toBe(true);
	});

	test("surfaces a rejected send visibly instead of losing it", async () => {
		const { driver, conversation } = makeDriver();
		conversation.sendImpl = async () => {
			throw new Error("queue full");
		};

		await driver.submit("third prompt");

		expect(
			driver.state.lines.some(
				(line) => line.role === "alert" && line.text.includes("queue full"),
			),
		).toBe(true);
		expect(conversation.sentPrompts).toEqual([]);
	});
});

describe("answering requests", () => {
	test("resolves a numbered choice to the option id", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness);

		await harness.driver.submit("2");

		expect(harness.conversation.answers).toEqual([
			{ requestId: "r1", choice: { kind: "option", value: "deny" } },
		]);
		await harness.waitFor((state) => state.pendingRequests.length === 0);
		expect(harness.conversation.sentPrompts).toEqual([]);
	});

	test("resolves an option id", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness);

		await harness.driver.submit("approve");

		expect(harness.conversation.answers).toEqual([
			{ requestId: "r1", choice: { kind: "option", value: "approve" } },
		]);
	});

	test("answers a freeform question with the typed text", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness, freeform);

		await harness.driver.submit("PawlStack");

		expect(harness.conversation.answers).toEqual([
			{ requestId: "q1", choice: { kind: "text", value: "PawlStack" } },
		]);
	});

	test("rejects invalid text without approving, prompting or queuing", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness);

		await harness.driver.submit("yes");

		expect(harness.conversation.answers).toEqual([]);
		expect(harness.conversation.sentPrompts).toEqual([]);
		expect(harness.driver.state.pendingRequests).toHaveLength(1);
		expect(
			harness.driver.state.lines.some(
				(line) =>
					line.role === "notice" && line.text.includes("Deploy PawlStack?"),
			),
		).toBe(true);
	});

	test("rejects a stale answer once the request is resolved", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness);
		harness.conversation.push({
			type: "input_resolved",
			runId: "run_1",
			requestId: "r1",
		});
		await harness.waitFor((state) => state.pendingRequests.length === 0);

		await harness.driver.submit("1");

		expect(harness.conversation.answers).toEqual([]);
		expect(harness.conversation.sentPrompts).toEqual([]);
		expect(
			harness.driver.state.lines.some(
				(line) => line.role === "notice" && line.text.includes("already"),
			),
		).toBe(true);
	});

	test("rejects a duplicate answer", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness);

		await harness.driver.submit("1");
		await harness.waitFor((state) => state.pendingRequests.length === 0);
		await harness.driver.submit("1");

		expect(harness.conversation.answers).toHaveLength(1);
		expect(harness.conversation.sentPrompts).toEqual([]);
		expect(
			harness.driver.state.lines.some(
				(line) => line.role === "notice" && line.text.includes("already"),
			),
		).toBe(true);
	});
});

describe("cancellation while waiting", () => {
	test("settles the pending request; late input is neither answer nor prompt", async () => {
		const harness = makeDriver(undefined, false);
		await openApprovalRun(harness);

		let releaseCancelled = () => {};
		const cancelSettled = new Promise<void>((resolve) => {
			releaseCancelled = resolve;
		});
		harness.conversation.cancelImpl = async () => {
			await cancelSettled;
		};
		const cancelling = harness.driver.cancel();
		await harness.driver.submit("1");
		// The cancel window rejects the answer: no approval slipped through.
		expect(harness.conversation.answers).toEqual([]);
		expect(
			harness.driver.state.lines.some((line) => line.role === "notice"),
		).toBe(true);

		releaseCancelled();
		await cancelling;
		harness.conversation.push({
			type: "run_terminal",
			runId: "run_1",
			outcome: "cancelled",
		});
		await harness.waitFor((state) => !state.busy);

		// After settlement the conversation is idle again: fresh input starts a
		// new prompt instead of being trapped as an approval.
		await harness.driver.submit("try again");
		expect(harness.conversation.sentPrompts).toEqual(["try again"]);
		expect(harness.conversation.answers).toEqual([]);
	});
});

describe("the event subscription answers while the run is blocked", () => {
	test("does not wait for run settlement before answering (promise barrier)", async () => {
		const conversation = new ScriptedConversation();
		conversation.completesRuns = false;
		let resumeAgent = () => {};
		const agentResumed = new Promise<void>((resolve) => {
			resumeAgent = resolve;
		});
		conversation.sendImpl = async (text, runId) => {
			void (async () => {
				conversation.push({ type: "user_message", runId, text, queued: false });
				conversation.push({ type: "run_started", runId });
				conversation.push({
					type: "input_requested",
					runId,
					request: approval,
				});
				// Barrier: the agent stays blocked on the approval and can only
				// continue once an answer was delivered to the conversation.
				await agentResumed;
				conversation.push({
					type: "run_terminal",
					runId,
					outcome: "completed",
				});
			})();
		};
		const harness = makeDriver(conversation);

		await harness.driver.submit("deploy now");
		await harness.waitFor((state) => state.awaitingInput);

		// The run has not ended and the agent is blocked, yet the answer must go
		// through without waiting for a terminal event.
		await harness.driver.submit("1");
		expect(harness.conversation.answers).toEqual([
			{ requestId: "r1", choice: { kind: "option", value: "approve" } },
		]);
		expect(harness.driver.state.busy).toBe(true);
		expect(harness.driver.state.pendingRequests).toEqual([]);

		resumeAgent();
		await harness.waitFor((state) => !state.busy);
		expect(harness.driver.state.status).toBe("");
	});
});

describe("disposal and late events", () => {
	test("dispose settles the conversation and ignores later input and events", async () => {
		const harness = makeDriver(undefined, false);

		await harness.driver.submit("long task");
		await harness.waitFor((state) => state.busy);
		await harness.driver.dispose();
		expect(harness.conversation.disposed).toBe(true);

		await harness.driver.submit("after close");
		expect(harness.conversation.sentPrompts).toEqual(["long task"]);
		expect(
			harness.driver.state.lines.some((line) => line.text.includes("closed")),
		).toBe(true);

		const settled = harness.driver.state;
		harness.conversation.push({
			type: "text_delta",
			runId: "run_1",
			delta: "late",
		});
		expect(harness.driver.state).toBe(settled);
	});

	test("ignores stream events after a run settles", async () => {
		const harness = makeDriver();
		await harness.driver.submit("hello");
		await harness.waitFor((state) => !state.busy);

		const settled = harness.driver.state;
		harness.conversation.push({
			type: "text_delta",
			runId: "run_1",
			delta: "late",
		});
		harness.conversation.push({
			type: "tool_result",
			runId: "run_1",
			toolCallId: "c9",
			status: "error",
		});

		expect(harness.driver.state).toBe(settled);
	});
});
