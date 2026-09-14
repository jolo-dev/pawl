/**
 * The seam between pawl's terminal client and the eve runtime.
 *
 * The client talks to a live `eve dev --no-ui` server over eve's HTTP session
 * API. It does not import the runtime, and it does not own the terminal — this
 * module only defines the conversation contract, so the renderer and the event
 * reducer can be tested without a server.
 *
 * Stream events are passed through as eve's own union rather than remapped:
 * `MessageStreamEvent` already carries the tool, reasoning, approval and
 * question events the UI needs, and re-declaring them would be a second
 * definition to keep in step.
 */

import {
	Client,
	type ClientSessionState,
	type InputResponse,
	type MessageStreamEvent,
	type StreamOptions,
} from "eve/client";

/** One durable conversation the client is driving. */
export interface PawlSession {
	readonly id: string;
	/** Sends a turn. Does not wait for it to finish; the stream reports outcome. */
	send(text: string): Promise<void>;
	/** Answers pending approval or question requests. */
	respond(inputResponses: readonly InputResponse[]): Promise<void>;
	cancel(turnId?: string): Promise<void>;
	/** The durable event stream, from the session's stored cursor. */
	events(): AsyncIterable<MessageStreamEvent>;
}

export interface PawlTransport {
	health(): Promise<{ status: string; workflowId: string }>;
	start(message: string): Promise<PawlSession>;
	attach(sessionId: string): PawlSession;
}

/**
 * The parts of eve's `ClientSession` this client relies on.
 *
 * Declared structurally so the adapter is testable against a fake, and so a
 * change to eve's session surface shows up as a type error here rather than at
 * runtime. The cast in `toPawlSession` is the single place that assumes eve's
 * class satisfies this shape.
 */
export interface EveSessionLike {
	readonly state: ClientSessionState;
	send(message: string): Promise<unknown>;
	respond(inputResponses: readonly InputResponse[]): Promise<unknown>;
	cancel(options?: { readonly turnId?: string }): Promise<unknown>;
	stream(options?: StreamOptions): AsyncIterable<MessageStreamEvent>;
}

/**
 * Adapt an eve session to the client's contract.
 *
 * `send` deliberately does not await the turn's result: the UI renders progress
 * from the stream, and blocking here would freeze it for the whole turn.
 */
export function toPawlSession(session: EveSessionLike): PawlSession {
	return {
		id: session.state.sessionId,
		async send(text) {
			await session.send(text);
		},
		async respond(inputResponses) {
			await session.respond(inputResponses);
		},
		async cancel(turnId) {
			await session.cancel(turnId === undefined ? undefined : { turnId });
		},
		events() {
			return session.stream();
		},
	};
}

export interface EveTransportOptions {
	readonly host: string;
}

/** The live transport, over eve's typed HTTP client. */
export function createEveTransport(
	options: EveTransportOptions,
): PawlTransport {
	const client = new Client({ host: options.host });

	return {
		async health() {
			const health = await client.health();
			return { status: health.status, workflowId: health.workflowId };
		},
		async start(message) {
			const { session } = await client.sessions.create({ message });
			return toPawlSession(session);
		},
		attach(sessionId) {
			return toPawlSession(client.sessions.attach(sessionId));
		},
	};
}
