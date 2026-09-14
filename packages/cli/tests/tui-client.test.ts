import { describe, expect, test } from "bun:test";
import type { MessageStreamEvent } from "eve/client";
import { type EveSessionLike, toPawlSession } from "../src/tui/client";

/**
 * The payload shape is irrelevant here: these tests assert that events pass
 * through untouched, not that a given event is well formed.
 */
const event = (type: string): MessageStreamEvent =>
	({ type, data: {} }) as unknown as MessageStreamEvent;

interface Recorded {
	readonly sent: string[];
	readonly responded: unknown[][];
	readonly cancelled: ({ turnId?: string } | undefined)[];
	streamCalls: number;
	resultCalled: boolean;
}

function fakeSession(events: MessageStreamEvent[]): {
	session: EveSessionLike;
	recorded: Recorded;
} {
	const recorded: Recorded = {
		sent: [],
		responded: [],
		cancelled: [],
		streamCalls: 0,
		resultCalled: false,
	};
	const session: EveSessionLike = {
		state: { sessionId: "wrun_fixture", streamIndex: 0 },
		async send(message) {
			recorded.sent.push(message);
			// eve resolves `send` on acceptance; `result()` is what waits for the
			// turn, and it is modelled as never settling so calling it would hang.
			return {
				result: () => {
					recorded.resultCalled = true;
					return new Promise(() => {});
				},
			};
		},
		async respond(inputResponses) {
			recorded.responded.push([...inputResponses]);
			return { ok: true };
		},
		async cancel(options) {
			recorded.cancelled.push(options);
			return { ok: true };
		},
		stream() {
			recorded.streamCalls++;
			return (async function* generate() {
				for (const item of events) yield item;
			})();
		},
	};
	return { session, recorded };
}

describe("toPawlSession", () => {
	test("takes its id from the session state", () => {
		const { session } = fakeSession([]);

		expect(toPawlSession(session).id).toBe("wrun_fixture");
	});

	test("forwards a sent message", async () => {
		const { session, recorded } = fakeSession([]);

		await toPawlSession(session).send("scan the account");

		expect(recorded.sent).toEqual(["scan the account"]);
	});

	test("does not wait for the turn's outcome before returning", async () => {
		const { session, recorded } = fakeSession([]);

		await toPawlSession(session).send("go");

		// Progress is rendered from the stream. Awaiting the turn outcome here
		// would freeze the UI until the agent finished, so `result()` must stay
		// untouched.
		expect(recorded.resultCalled).toBe(false);
	});

	test("forwards approval and question responses", async () => {
		const { session, recorded } = fakeSession([]);
		const responses = [{ requestId: "r1", outcome: "approved" }];

		await toPawlSession(session).respond(responses);

		expect(recorded.responded).toEqual([responses]);
	});

	test("forwards a turn id when cancelling", async () => {
		const { session, recorded } = fakeSession([]);

		await toPawlSession(session).cancel("turn_1");

		expect(recorded.cancelled).toEqual([{ turnId: "turn_1" }]);
	});

	test("cancels whatever is active when no turn id is given", async () => {
		const { session, recorded } = fakeSession([]);

		await toPawlSession(session).cancel();

		expect(recorded.cancelled).toEqual([undefined]);
	});

	test("yields the session's stream events unchanged", async () => {
		const { session, recorded } = fakeSession([
			event("turn.started"),
			event("turn.completed"),
		]);

		const seen: string[] = [];
		for await (const item of toPawlSession(session).events()) {
			seen.push(item.type);
		}

		expect(seen).toEqual(["turn.started", "turn.completed"]);
		expect(recorded.streamCalls).toBe(1);
	});
});
