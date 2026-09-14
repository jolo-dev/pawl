import { describe, expect, test } from "bun:test";
import {
	type InputRequest,
	isCurrentTurnBoundaryEvent,
	type MessageStreamEvent,
} from "eve/client";
import type { PawlSession } from "../src/tui/client";
import { createInputQueue } from "../src/tui/prompter";
import { INITIAL_TUI_STATE, type TuiState } from "../src/tui/reducer";
import {
	consumeTurn,
	type InputAction,
	routeInput,
	runInteractiveSession,
	type SessionView,
} from "../src/tui/session";

const event = (
	type: string,
	data: Record<string, unknown> = {},
): MessageStreamEvent =>
	({
		type,
		data,
		meta: { at: new Date().toISOString(), id: `evt_${type}` },
	}) as unknown as MessageStreamEvent;

const approval: InputRequest = {
	action: {
		callId: "c1",
		input: {},
		kind: "tool-call",
		toolName: "deploy_infra",
	},
	display: "confirmation",
	kind: "tool-approval",
	options: [
		{ id: "approve", label: "Approve" },
		{ id: "deny", label: "Deny" },
	],
	prompt: "Deploy PawlStack?",
	requestId: "r1",
};

const freeform: InputRequest = {
	action: {
		callId: "c2",
		input: {},
		kind: "tool-call",
		toolName: "ask_question",
	},
	allowFreeform: true,
	display: "text",
	kind: "question",
	prompt: "Which region?",
	requestId: "r2",
};

const withPending = (requests: InputRequest[]): TuiState => ({
	...INITIAL_TUI_STATE,
	pendingRequests: requests,
});

describe("routeInput", () => {
	test("sends a new turn when nothing is pending", () => {
		expect(routeInput("scan my account", INITIAL_TUI_STATE)).toEqual({
			kind: "send",
			text: "scan my account",
		});
	});

	test("answers a pending approval with a numbered choice", () => {
		const action = routeInput("1", withPending([approval]));

		expect(action.kind).toBe("respond");
		if (action.kind !== "respond") return;
		expect(action.responses).toHaveLength(1);
	});

	test("reports an unmatchable answer instead of sending it as a turn", () => {
		// The dangerous case: a user types "yes" at an approval prompt. Sending it
		// as a turn would start unrelated work while they believe they approved a
		// deploy.
		expect(routeInput("yes", withPending([approval]))).toEqual({
			kind: "unresolved",
			text: "yes",
		});
	});

	test("reports nonsense at a confirmation the same way", () => {
		expect(routeInput("nonsense", withPending([approval])).kind).toBe(
			"unresolved",
		);
	});

	test("accepts freeform text for a question that allows it", () => {
		const action = routeInput("eu-central-1", withPending([freeform]));

		expect(action.kind).toBe("respond");
	});

	test("trims the answer before routing it", () => {
		const action: InputAction = routeInput("  1  ", withPending([approval]));

		expect(action.kind).toBe("respond");
	});
});

interface FakeSessionOptions {
	/** One array of events per turn, in order. */
	readonly turns: MessageStreamEvent[][];
	readonly boundaryLast?: boolean;
}

function fakeSession(options: FakeSessionOptions): {
	session: PawlSession;
	readonly sent: string[];
	readonly responded: unknown[][];
} {
	let turn = 0;
	const sent: string[] = [];
	const responded: unknown[][] = [];
	return {
		sent,
		responded,
		session: {
			id: "wrun_fixture",
			async send(text) {
				sent.push(text);
			},
			async respond(responses) {
				responded.push([...responses]);
			},
			async cancel() {},
			events() {
				const scripted = options.turns[turn] ?? [];
				turn++;
				return (async function* generate() {
					for (const item of scripted) {
						yield item;
						if (!options.boundaryLast && isCurrentTurnBoundaryEvent(item)) {
							return;
						}
					}
				})();
			},
		},
	};
}

function view(): { view: SessionView; lines: string[]; alerts: string[] } {
	const lines: string[] = [];
	const alerts: string[] = [];
	return {
		lines,
		alerts,
		view: {
			present(state) {
				lines.push(...state.lines.map((line) => `${line.role}:${line.text}`));
			},
			alert(text) {
				alerts.push(text);
			},
		},
	};
}

describe("consumeTurn", () => {
	test("stops at the session boundary rather than following forever", async () => {
		// The real stream order: turn.completed, then session.waiting.
		const { session } = fakeSession({
			turns: [
				[
					event("message.appended", { messageDelta: "one" }),
					event("turn.completed", {}),
					event("session.waiting", {}),
					// Anything after the boundary belongs to the next turn.
					event("message.appended", { messageDelta: "two" }),
				],
			],
		});
		const { view: sessionView, lines } = view();

		const state = await consumeTurn(session, sessionView, INITIAL_TUI_STATE);

		expect(state.lines.map((line) => line.text)).toEqual(["one"]);
		expect(lines).toContain("assistant:one");
		expect(lines.join("\n")).not.toContain("two");
	});

	test("ends on a turn terminal, because eve's predicate is session-level only", async () => {
		// eve's isCurrentTurnBoundaryEvent returns false for turn.completed, so a
		// turn that ends without the session parking would otherwise hang the
		// client on a stream that follows the durable tail forever.
		const { session } = fakeSession({
			turns: [[event("turn.completed", {})]],
		});
		const { view: sessionView } = view();

		const state = await consumeTurn(session, sessionView, INITIAL_TUI_STATE);

		expect(state.busy).toBe(false);
	});

	test("accumulates state across the events it consumes", async () => {
		const { session } = fakeSession({
			turns: [
				[
					event("turn.started", { turnId: "turn_1" }),
					event("message.appended", { messageDelta: "hi" }),
					event("turn.failed", { code: "MODEL_CALL_FAILED", message: "boom" }),
				],
			],
		});
		const { view: sessionView } = view();

		const state = await consumeTurn(session, sessionView, INITIAL_TUI_STATE);

		expect(state.failure?.code).toBe("MODEL_CALL_FAILED");
		expect(state.busy).toBe(false);
	});
});

describe("runInteractiveSession", () => {
	test("sends a first turn and then a typed message", async () => {
		const { session, sent } = fakeSession({
			turns: [
				[
					event("message.appended", { messageDelta: "ready" }),
					event("turn.completed", {}),
				],
				[
					event("message.appended", { messageDelta: "scanned" }),
					event("turn.completed", {}),
				],
			],
		});
		const { view: sessionView } = view();
		const input = createInputQueue();
		input.submit("scan my account");

		const state = await runInteractiveSession({
			session,
			view: sessionView,
			input,
			maxTurns: 2,
		});

		expect(sent).toEqual(["scan my account"]);
		const texts = state.lines.map((line) => line.text);
		expect(texts).toContain("scan my account");
		expect(texts).toContain("scanned");
	});

	test("answers a pending approval rather than sending it as a turn", async () => {
		const { session, sent, responded } = fakeSession({
			turns: [
				[
					event("input.requested", { requests: [approval] }),
					event("turn.completed", {}),
				],
				[event("turn.completed", {})],
			],
		});
		const { view: sessionView } = view();
		const input = createInputQueue();
		input.submit("1");

		await runInteractiveSession({
			session,
			view: sessionView,
			input,
			maxTurns: 2,
		});

		expect(responded).toHaveLength(1);
		expect(sent).toEqual([]);
	});

	test("tells the user when an answer matched nothing", async () => {
		const { session, sent } = fakeSession({
			turns: [
				[
					event("input.requested", { requests: [approval] }),
					event("turn.completed", {}),
				],
				[event("turn.completed", {})],
			],
		});
		const { view: sessionView, alerts } = view();
		const input = createInputQueue();
		input.submit("yes");

		await runInteractiveSession({
			session,
			view: sessionView,
			input,
			maxTurns: 2,
		});

		// Nothing is sent, and the user is told why rather than left guessing.
		expect(sent).toEqual([]);
		expect(alerts.join(" ")).toContain("number or an option id");
	});

	test("keeps the echoed message in the transcript that is presented", async () => {
		const { session } = fakeSession({
			turns: [[event("turn.completed", {})], [event("turn.completed", {})]],
		});
		const { view: sessionView, lines } = view();
		const input = createInputQueue();
		input.submit("hello");

		await runInteractiveSession({
			session,
			view: sessionView,
			input,
			maxTurns: 2,
		});

		expect(lines).toContain("user:hello");
	});
});
