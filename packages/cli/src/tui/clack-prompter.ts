/**
 * The pre-flight prompter backed by @clack/prompts.
 *
 * The client asked for this shape back: the TUI handles the conversation, while
 * the pre-flight runs as a plain terminal flow with clack's select prompts. The
 * machine (`preflight.ts`) stays injection-driven, so the same tested control
 * flow can be driven by either prompter.
 */

import { intro, outro, select, spinner, text } from "@clack/prompts";
import { BACK, type PreflightPrompter } from "./preflight";

/** An option that navigates back one step. */
const BACK_VALUE = "__back__";

export function createClackPrompter(
	selectPrompt: typeof select<string> = select<string>,
): PreflightPrompter {
	return {
		status(message) {
			// clack's spinner needs an owner per message, so a status is a spinner
			// that is stopped immediately: it reads as a completed step.
			const spin = spinner();
			spin.start(message);
			spin.stop(`${message} ✓`);
		},

		notice(message) {
			console.log(message);
		},

		async select(request) {
			const choices = request.options.map((option) => ({
				value: option.value,
				label: option.label,
			}));
			if (request.allowBack) {
				// clack's select has no cancel-and-go-back, so back is a choice.
				choices.push({ value: BACK_VALUE, label: "← Back" });
			}

			for (;;) {
				const chosen = await selectPrompt({
					message: request.message,
					options: choices,
					initialValue: request.initialValue,
				});
				if (typeof chosen !== "string") return null;
				if (request.allowBack && chosen === BACK_VALUE) return BACK;
				return chosen;
			}
		},

		async text(request) {
			for (;;) {
				const value = await text({
					message: request.message,
					initialValue: request.initialValue,
					validate: request.validate as undefined,
				});
				if (typeof value !== "string") return null;
				if (request.validate) {
					const problem = request.validate(value);
					if (problem !== undefined) {
						const spin = spinner();
						spin.start(problem);
						spin.stop(problem);
						continue;
					}
				}
				return value;
			}
		},
	};
}

/** Opens and closes the pre-flight, the same wrapper clack's own flows use. */
export function clackBookends(title: string): {
	begin: () => void;
	end: (message: string) => void;
} {
	return {
		begin: () => intro(title),
		end: (message) => outro(message),
	};
}
