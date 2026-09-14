/**
 * A pre-flight prompter backed by the transcript.
 *
 * Q2 fixed the shape as one pane carrying the conversation, so a selection is a
 * numbered list of transcript lines rather than a separate widget. That is not
 * just a styling choice: it keeps the pre-flight in the scrollback with the rest
 * of the session, so a user can see which profile and model they chose after the
 * fact.
 *
 * The reading half is separated from the rendering half so the answer parsing —
 * which is where the bugs would be — is testable without a terminal.
 */

import type { TranscriptRole } from "./app";
import { BACK, type PreflightPrompter, type SelectResult } from "./preflight";

/**
 * Hands submitted input to whoever is waiting for it.
 *
 * The client wires the app's submit handler to `submit`; the prompter awaits
 * `next`. One waiter at a time, because a prompt is a single conversation.
 */
export interface InputQueue {
	submit(text: string): void;
	next(): Promise<string>;
}

export function createInputQueue(): InputQueue {
	const pending: string[] = [];
	const waiters: ((text: string) => void)[] = [];

	return {
		submit(text) {
			const waiter = waiters.shift();
			if (waiter) {
				waiter(text);
				return;
			}
			pending.push(text);
		},
		next() {
			const queued = pending.shift();
			if (queued !== undefined) return Promise.resolve(queued);
			return new Promise<string>((resolve) => {
				waiters.push(resolve);
			});
		},
	};
}

/**
 * Value carried by the widget's back entry, mapped back to {@link BACK} by the
 * prompter. Distinct enough that no real option id is expected to collide.
 */
const BACK_VALUE = "\u0000back";

/** Turns a typed answer into one of the offered values, or explains why not. */
export function resolveSelection(
	answer: string,
	options: readonly { readonly value: string }[],
	allowBack: boolean,
):
	| { readonly kind: "value"; readonly value: string }
	| { readonly kind: "back" }
	| { readonly kind: "invalid"; readonly reason: string } {
	const trimmed = answer.trim();

	if (allowBack && (trimmed === "b" || trimmed.toLowerCase() === "back")) {
		return { kind: "back" };
	}

	const index = Number.parseInt(trimmed, 10);
	if (Number.isInteger(index) && String(index) === trimmed) {
		const option = options[index - 1];
		if (option) return { kind: "value", value: option.value };
		return {
			kind: "invalid",
			reason: `Enter a number between 1 and ${options.length}${allowBack ? ', or "b" to go back' : ""}.`,
		};
	}

	const exact = options.find((option) => option.value === trimmed);
	if (exact) return { kind: "value", value: exact.value };

	return {
		kind: "invalid",
		reason: `Enter a number between 1 and ${options.length}${allowBack ? ', or "b" to go back' : ""}.`,
	};
}

/**
 * The smallest part of the shell the pre-flight needs.
 *
 * Declared here rather than reusing `PawlApp` because the prompter writes to the
 * transcript and never uses what `append` returns — demanding a renderable back
 * would force every caller and every test to manufacture one.
 */
export interface TranscriptSink {
	append(role: TranscriptRole, text: string): unknown;
	setStatus(text: string, role?: TranscriptRole): void;
}

export interface TuiPrompterOptions {
	readonly app: TranscriptSink;
	readonly input: InputQueue;
	/**
	 * Opens a select for a choice. Omitted when the caller has no widget, in
	 * which case selections fall back to numbered transcript lines.
	 */
	readonly promptSelect?: (request: {
		readonly message: string;
		readonly choices: readonly {
			readonly value: string;
			readonly label: string;
		}[];
	}) => Promise<string | null>;
}

export function createTuiPrompter(
	options: TuiPrompterOptions,
): PreflightPrompter {
	const { app, input } = options;

	return {
		status(message) {
			app.setStatus(message);
		},

		notice(message) {
			app.append("notice", message);
		},

		async select(request): Promise<SelectResult> {
			const allowBack = request.allowBack === true;

			// A widget select is preferred when the caller provides one: arrow keys
			// and a highlighted row beat reading a numbered list. Back is offered as
			// a choice, because a select has no cancel path of its own.
			if (options.promptSelect) {
				const choices = request.options.map((option) => ({
					value: option.value,
					label: option.label,
				}));
				if (allowBack) {
					choices.push({ value: BACK_VALUE, label: "← Back" });
				}
				const chosen = await options.promptSelect({
					message: request.message,
					choices,
				});
				if (chosen === null) return null;
				if (allowBack && chosen === BACK_VALUE) return BACK;
				return chosen;
			}

			const allowBackFallback = allowBack;
			app.append("notice", request.message);
			for (const [index, option] of request.options.entries()) {
				app.append("notice", `  ${index + 1}) ${option.label}`);
			}
			if (allowBack) app.append("notice", "  b) back");

			for (;;) {
				const resolution = resolveSelection(
					await input.next(),
					request.options,
					allowBackFallback,
				);
				if (resolution.kind === "value") return resolution.value;
				if (resolution.kind === "back") return BACK;
				app.append("alert", resolution.reason);
			}
		},

		async text(request): Promise<string | null> {
			app.append("notice", request.message);
			if (request.initialValue) {
				app.append("notice", `  ${request.initialValue}`);
			}

			for (;;) {
				const answer = (await input.next()).trim();
				const value = answer.length > 0 ? answer : (request.initialValue ?? "");
				const problem = request.validate?.(value);
				if (problem === undefined) return value;
				app.append("alert", problem);
			}
		},
	};
}
