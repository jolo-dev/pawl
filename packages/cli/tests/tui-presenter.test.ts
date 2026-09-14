import { describe, expect, test } from "bun:test";
import { createPresenter, type PresenterTarget } from "../src/tui/presenter";
import { INITIAL_TUI_STATE, type TuiState } from "../src/tui/reducer";

interface Recorded {
	readonly appended: string[];
	readonly updated: string[];
	readonly statuses: string[];
	clears: number;
}

function recorder(): { target: PresenterTarget; recorded: Recorded } {
	const recorded: Recorded = {
		appended: [],
		updated: [],
		statuses: [],
		clears: 0,
	};
	const target: PresenterTarget = {
		append(role, text) {
			recorded.appended.push(`${role}:${text}`);
			return undefined;
		},
		updateLast(role, text) {
			recorded.updated.push(`${role}:${text}`);
		},
		setStatus(text, role) {
			recorded.statuses.push(role ? `${role}:${text}` : text);
		},
		clearTranscript() {
			recorded.clears++;
		},
	};
	return { target, recorded };
}

const state = (
	lines: { role: "assistant" | "notice"; text: string; open: boolean }[],
	over: Partial<TuiState> = {},
): TuiState => ({
	...INITIAL_TUI_STATE,
	lines,
	...over,
});

describe("createPresenter", () => {
	test("appends only the lines that are new", () => {
		const { target, recorded } = recorder();
		const presenter = createPresenter(target);

		presenter.present(state([{ role: "assistant", text: "one", open: false }]));
		presenter.present(
			state([
				{ role: "assistant", text: "one", open: false },
				{ role: "notice", text: "two", open: false },
			]),
		);

		expect(recorded.appended).toEqual(["assistant:one", "notice:two"]);
		expect(recorded.updated).toEqual([]);
	});

	test("rewrites a growing line instead of appending it again", () => {
		const { target, recorded } = recorder();
		const presenter = createPresenter(target);

		presenter.present(state([{ role: "assistant", text: "Two ", open: true }]));
		presenter.present(
			state([{ role: "assistant", text: "Two findings.", open: true }]),
		);

		// Re-creating the line per delta would be quadratic on a long reply.
		expect(recorded.appended).toEqual(["assistant:Two "]);
		expect(recorded.updated).toEqual(["assistant:Two findings."]);
	});

	test("re-presenting the same state changes nothing", () => {
		const { target, recorded } = recorder();
		const presenter = createPresenter(target);
		const once = state([{ role: "assistant", text: "settled", open: false }]);

		presenter.present(once);
		presenter.present(once);
		presenter.present(once);

		expect(recorded.appended).toEqual(["assistant:settled"]);
		expect(recorded.updated).toEqual([]);
	});

	test("styles a failure status as an alert", () => {
		const { target, recorded } = recorder();
		const presenter = createPresenter(target);

		presenter.present(
			state([], {
				status: "MODEL_CALL_FAILED",
				failure: { code: "MODEL_CALL_FAILED", message: "no credentials" },
			}),
		);

		expect(recorded.statuses).toEqual(["alert:MODEL_CALL_FAILED"]);
	});

	test("uses an ordinary role for normal status", () => {
		const { target, recorded } = recorder();
		const presenter = createPresenter(target);

		presenter.present(state([], { status: "Working" }));

		expect(recorded.statuses).toEqual(["notice:Working"]);
	});

	test("reset forgets what was rendered so a cleared transcript refills", () => {
		const { target, recorded } = recorder();
		const presenter = createPresenter(target);
		const line = state([{ role: "assistant", text: "one", open: false }]);

		presenter.present(line);
		presenter.reset();
		presenter.present(line);

		expect(recorded.clears).toBe(1);
		expect(recorded.appended).toEqual(["assistant:one", "assistant:one"]);
	});
});
