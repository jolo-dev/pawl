#!/usr/bin/env bun
/**
 * Live verification of the session driver against a real eve server.
 *
 * This exists because every event shape the reducer handles comes from eve's
 * type definitions, and a mismatch there degrades to "ignored event" — it fails
 * silently by design. This is the only check that compares the client's
 * assumptions with what the runtime actually streams. It already caught one real
 * bug that the unit suite could not: breaking consumption on `turn.completed`
 * left `session.waiting` queued, so the *next* turn was never read.
 *
 * It costs real model calls. Run it when the reducer, the driver, or eve itself
 * changes.
 *
 * Usage:
 *   cd packages/cli
 *   AWS_PROFILE=<profile> AWS_REGION=<region> bunx eve dev --no-ui --port 2145 &
 *   bun scripts/verify-live-session.ts http://127.0.0.1:2145
 *
 * Exits non-zero when an expectation fails, so it can gate a change.
 */

import { createEveTransport, type PawlSession } from "../src/tui/client";
import { INITIAL_TUI_STATE, type TuiState } from "../src/tui/reducer";
import { consumeTurn, routeInput, type SessionView } from "../src/tui/session";

const host = process.argv[2] ?? "http://127.0.0.1:2145";
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures.push(label);
	console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const types: string[] = [];
let state: TuiState = INITIAL_TUI_STATE;
const alerts: string[] = [];
const view: SessionView = {
	present(next) {
		state = next;
	},
	alert(text) {
		alerts.push(text);
	},
};

/** Records every event type while letting `consumeTurn` consume them. */
function tee(session: PawlSession): PawlSession {
	return {
		...session,
		events() {
			return (async function* generate() {
				for await (const event of session.events()) {
					types.push(event.type);
					yield event;
				}
			})();
		},
	};
}

const transport = createEveTransport({ host });
const health = await transport.health();
check("server is ready", health.status === "ready", health.status);

console.log("\nturn 1 — plain reply");
const session = tee(
	await transport.start(
		"Reply with exactly: REDUCER-OK. Do not call any tools.",
	),
);
const turn1Start = types.length;
state = await consumeTurn(session, view, state);
console.log(`  events: ${[...new Set(types.slice(turn1Start))].join(" ")}`);
check(
	"assistant text reached the transcript",
	state.lines.some(
		(line) => line.role === "assistant" && line.text.includes("REDUCER-OK"),
	),
	JSON.stringify(state.lines.map((line) => line.text.slice(0, 40))),
);
check("no failure recorded", state.failure === null);
check("busy cleared at the boundary", state.busy === false);
check(
	"the session parked, so the next turn will be read",
	types.slice(turn1Start).includes("session.waiting"),
);

console.log("\nturn 2 — a human-input request");
// ask_question is non-mutating, which is why it is used here rather than a
// gated tool like deploy_infra.
await session.send(
	"Call the ask_question tool once: ask which AWS region to use, with options 'eu-central-1' and 'us-east-1'. Do not do anything else.",
);
const turn2Start = types.length;
state = await consumeTurn(session, view, state);
console.log(`  events: ${[...new Set(types.slice(turn2Start))].join(" ")}`);
const raised = state.pendingRequests.length > 0;
if (!raised) {
	console.log(
		"  note: the model declined to raise a request, so the input path is unverified this run",
	);
} else {
	check("the request is pending", raised);
	check(
		"its options were rendered",
		state.lines.some((line) => line.text.includes("1) ")),
	);

	console.log("\nanswering it");
	const action = routeInput("1", state);
	check(
		"a numbered answer routes to respond, not to send",
		action.kind === "respond",
	);
	if (action.kind === "respond") {
		await session.respond(action.responses);
		const turn3Start = types.length;
		state = await consumeTurn(session, view, state);
		console.log(`  events: ${[...new Set(types.slice(turn3Start))].join(" ")}`);
		check(
			"the request was resolved",
			state.pendingRequests.length === 0,
			`${state.pendingRequests.length} still pending`,
		);
		check("the turn after answering completed", state.busy === false);
	}
}

console.log(`\n${types.length} events, ${alerts.length} alerts`);
if (failures.length > 0) {
	console.error(`\nFAILED: ${failures.join("; ")}`);
	process.exit(1);
}
console.log("\nAll live checks passed.");
