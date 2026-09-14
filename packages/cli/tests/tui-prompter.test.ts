import { describe, expect, test } from "bun:test";
import { BACK } from "../src/tui/preflight";
import {
	createInputQueue,
	createTuiPrompter,
	resolveSelection,
} from "../src/tui/prompter";

const OPTIONS = [
	{ value: "dev", label: "dev" },
	{ value: "prod", label: "prod" },
];

describe("resolveSelection", () => {
	test("maps a number to the offered value", () => {
		expect(resolveSelection("2", OPTIONS, false)).toEqual({
			kind: "value",
			value: "prod",
		});
	});

	test("accepts the value itself", () => {
		expect(resolveSelection("dev", OPTIONS, false)).toEqual({
			kind: "value",
			value: "dev",
		});
	});

	test("tolerates surrounding whitespace", () => {
		expect(resolveSelection("  1  ", OPTIONS, false)).toEqual({
			kind: "value",
			value: "dev",
		});
	});

	test("rejects an out-of-range number rather than wrapping", () => {
		const result = resolveSelection("0", OPTIONS, false);
		expect(result.kind).toBe("invalid");
		expect(resolveSelection("3", OPTIONS, false).kind).toBe("invalid");
	});

	test("rejects a number with trailing characters", () => {
		expect(resolveSelection("1x", OPTIONS, false).kind).toBe("invalid");
	});

	test("offers back only when the step allows it", () => {
		expect(resolveSelection("b", OPTIONS, true)).toEqual({ kind: "back" });
		expect(resolveSelection("back", OPTIONS, true)).toEqual({ kind: "back" });
		expect(resolveSelection("b", OPTIONS, false).kind).toBe("invalid");
	});

	test("does not treat a value that looks like back as back", () => {
		const options = [{ value: "b", label: "b" }];
		expect(resolveSelection("b", options, false)).toEqual({
			kind: "value",
			value: "b",
		});
	});
});

interface FakeApp {
	readonly lines: string[];
	readonly statuses: string[];
	append: (role: string, text: string) => void;
	setStatus: (text: string) => void;
}

function fakeApp(): FakeApp {
	const lines: string[] = [];
	const statuses: string[] = [];
	return {
		lines,
		statuses,
		append(_role, text) {
			lines.push(text);
		},
		setStatus(text) {
			statuses.push(text);
		},
	};
}

describe("createTuiPrompter", () => {
	test("reports progress through the status line", () => {
		const app = fakeApp();
		const prompter = createTuiPrompter({ app, input: createInputQueue() });

		prompter.status("Checking credentials");

		expect(app.statuses).toEqual(["Checking credentials"]);
	});

	test("puts the options in the transcript so they stay in the history", async () => {
		const app = fakeApp();
		const input = createInputQueue();
		const prompter = createTuiPrompter({ app, input });

		const selection = prompter.select({
			id: "profile",
			message: "Select an AWS profile",
			options: OPTIONS,
		});
		input.submit("2");

		expect(await selection).toBe("prod");
		expect(app.lines.join("\n")).toContain("1) dev");
		expect(app.lines.join("\n")).toContain("2) prod");
	});

	test("re-asks after an unusable answer instead of guessing", async () => {
		const app = fakeApp();
		const input = createInputQueue();
		const prompter = createTuiPrompter({ app, input });

		const selection = prompter.select({
			id: "profile",
			message: "Select an AWS profile",
			options: OPTIONS,
		});
		input.submit("nonsense");
		input.submit("1");

		expect(await selection).toBe("dev");
		expect(app.lines.some((line) => line.includes("Enter a number"))).toBe(
			true,
		);
	});

	test("offers a back option only when the step allows going back", async () => {
		const app = fakeApp();
		const input = createInputQueue();
		const prompter = createTuiPrompter({ app, input });

		const selection = prompter.select({
			id: "model",
			message: "Select model",
			options: OPTIONS,
			allowBack: true,
		});
		input.submit("b");

		expect(await selection).toBe(BACK);
		expect(app.lines.join("\n")).toContain("b) back");
	});

	test("takes the offered default when the answer is empty", async () => {
		const app = fakeApp();
		const input = createInputQueue();
		const prompter = createTuiPrompter({ app, input });

		const answer = prompter.text({
			id: "region",
			message: "AWS region",
			initialValue: "eu-central-1",
		});
		input.submit("   ");

		expect(await answer).toBe("eu-central-1");
	});

	test("re-asks when a validator rejects the value", async () => {
		const app = fakeApp();
		const input = createInputQueue();
		const prompter = createTuiPrompter({ app, input });

		const answer = prompter.text({
			id: "region",
			message: "AWS region",
			validate: (value) =>
				value.length > 0 ? undefined : "Region is required",
		});
		input.submit("");
		input.submit("us-east-1");

		// An empty answer with no default fails validation rather than being
		// accepted as an empty region.
		expect(await answer).toBe("us-east-1");
		expect(app.lines).toContain("Region is required");
	});
});

describe("createInputQueue", () => {
	test("hands a submission to a waiter", async () => {
		const queue = createInputQueue();
		const waiting = queue.next();

		queue.submit("dev");

		expect(await waiting).toBe("dev");
	});

	test("queues a submission that arrives before anyone waits", async () => {
		const queue = createInputQueue();

		queue.submit("prod");

		expect(await queue.next()).toBe("prod");
	});

	test("keeps submissions in order", async () => {
		const queue = createInputQueue();

		queue.submit("first");
		queue.submit("second");

		expect(await queue.next()).toBe("first");
		expect(await queue.next()).toBe("second");
	});
});
