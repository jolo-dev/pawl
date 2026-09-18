import { describe, expect, test } from "bun:test";
import {
	APPROVAL_TIMEOUT_MS,
	type ApprovalBinding,
	ApprovalBroker,
	approvalBindingDigest,
} from "../src/pi-runtime/approval";
import type { PawlAnswer } from "../src/pi-runtime/conversation";

/**
 * Task 6 approval gate: an approval is bound to run/request/tool-call ids,
 * canonical arguments, plan/artifact digest, project and checked identity.
 * Answers are one-use; grants are consumed at the actual executor/write
 * boundary, never by the UI answer alone, and never survive a restart.
 */

function binding(overrides: Partial<ApprovalBinding> = {}): ApprovalBinding {
	return {
		runId: "run_1",
		toolCallId: "call_1",
		toolName: "deploy_infra",
		input: {
			stackName: "PawlStack",
			option: { file: "cdk.out/manifest.json" },
		},
		planDigest: "sha256:plan-abc",
		projectDir: "/proj",
		identity: { accountId: "111111111111", region: "us-east-1" },
		previewComplete: true,
		...overrides,
	};
}

function fakeClock() {
	let nowMs = 0;
	const timers: { at: number; handler: () => void; cancelled: boolean }[] = [];
	const now = () => nowMs;
	const scheduleTimeout = (handler: () => void, ms: number) => {
		const timer = { at: nowMs + ms, handler, cancelled: false };
		timers.push(timer);
		return () => {
			timer.cancelled = true;
		};
	};
	const advance = (ms: number) => {
		nowMs += ms;
		for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
			if (!timer.cancelled && timer.at <= nowMs) timer.handler();
		}
	};
	return { now, scheduleTimeout, advance };
}

interface Fixture {
	broker: ApprovalBroker;
	clock: ReturnType<typeof fakeClock>;
	questions: {
		requestId: string;
		prompt: string;
		options: readonly { id: string; label: string }[];
	}[];
	run: AbortController;
}

function fixture(): Fixture {
	const clock = fakeClock();
	const run = new AbortController();
	const questions: Fixture["questions"] = [];
	const broker = new ApprovalBroker({
		now: clock.now,
		scheduleTimeout: clock.scheduleTimeout,
		signal: run.signal,
		onRequest: (question) => questions.push(question),
	});
	return { broker, clock, questions, run };
}

function approve(requestId: string): PawlAnswer {
	return { requestId, choice: { kind: "option", value: "approve" } };
}

function deny(requestId: string): PawlAnswer {
	return { requestId, choice: { kind: "option", value: "deny" } };
}

describe("approval binding", () => {
	test("digests cover every binding dimension", () => {
		const base = approvalBindingDigest(binding());
		expect(base).not.toBe(approvalBindingDigest(binding({ runId: "run_2" })));
		expect(base).not.toBe(
			approvalBindingDigest(binding({ toolCallId: "call_2" })),
		);
		expect(base).not.toBe(
			approvalBindingDigest(binding({ toolName: "generate" })),
		);
		expect(base).not.toBe(
			approvalBindingDigest(binding({ input: { stackName: "Other" } })),
		);
		expect(base).not.toBe(
			approvalBindingDigest(binding({ planDigest: "sha256:other" })),
		);
		expect(base).not.toBe(
			approvalBindingDigest(binding({ projectDir: "/p2" })),
		);
		expect(base).not.toBe(
			approvalBindingDigest(
				binding({
					identity: { accountId: "222222222222", region: "us-east-1" },
				}),
			),
		);
		expect(base).not.toBe(
			approvalBindingDigest(
				binding({
					identity: { accountId: "111111111111", region: "eu-west-1" },
				}),
			),
		);
		// Canonical argument order is irrelevant.
		expect(base).toBe(
			approvalBindingDigest(
				binding({
					input: {
						option: { file: "cdk.out/manifest.json" },
						stackName: "PawlStack",
					},
				}),
			),
		);
	});
});

describe("question and answer flow", () => {
	test("surfacing a question never grants by itself", async () => {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		expect(questions).toHaveLength(1);
		expect(questions[0]?.options.map((option) => option.id)).toEqual([
			"approve",
			"deny",
		]);
		expect(questions[0]?.prompt).toContain("deploy_infra");
		let outcome: Awaited<ReturnType<ApprovalBroker["request"]>> | undefined;
		void pending.then((value) => {
			outcome = value;
		});
		await Bun.sleep(1);
		// No answer yet: nothing granted, nothing to consume.
		expect(outcome).toBeUndefined();
		const answer = deny(questions[0]?.requestId ?? "");
		await broker.answer(answer);
		const settled = await pending;
		expect(settled.granted).toBe(false);
	});

	test("an approve answer issues a one-use grant consumed at the write boundary", async () => {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		const writes: string[] = [];
		const write = () => {
			// The executor consumes the grant at the actual write boundary.
			const consumption = outcome.grant.consume(binding());
			if (!consumption.ok) throw new Error(consumption.message);
			writes.push("generated");
			return "written";
		};
		expect(write()).toBe("written");
		// One use: a second write attempt with the same grant is refused.
		expect(outcome.grant.consume(binding()).ok).toBe(false);
		expect(writes).toEqual(["generated"]);
	});

	test("a denial stops the operation and never yields a grant", async () => {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		await broker.answer(deny(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		expect(outcome).toEqual({
			granted: false,
			reason: "denied",
			message: expect.any(String),
		});
	});

	test("a freeform text answer is never an approval", async () => {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "text", value: "yes please" },
		});
		const outcome = await pending;
		expect(outcome.granted).toBe(false);
	});

	test("stale and duplicate answers are rejected without side effects", async () => {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		const requestId = questions[0]?.requestId ?? "";
		await broker.answer(approve(requestId));
		await expect(broker.answer(approve(requestId))).rejects.toThrow(
			/stale|unknown|resolved/i,
		);
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		// The duplicate answer did not burn the grant.
		expect(outcome.grant.consume(binding()).ok).toBe(true);
	});

	test("an unknown request id is rejected", async () => {
		const { broker } = fixture();
		await expect(broker.answer(approve("nope"))).rejects.toThrow(
			/stale|unknown/i,
		);
	});
});

describe("expiry and cancellation", () => {
	test("an approval expires after five minutes", async () => {
		const { broker, questions, clock } = fixture();
		const pending = broker.request(binding());
		clock.advance(APPROVAL_TIMEOUT_MS + 1);
		const outcome = await pending;
		expect(outcome).toEqual({
			granted: false,
			reason: "expired",
			message: expect.any(String),
		});
		await expect(
			broker.answer(approve(questions[0]?.requestId ?? "")),
		).rejects.toThrow();
	});

	test("a parent run cancel settles the pending approval", async () => {
		const { broker, run } = fixture();
		const pending = broker.request(binding());
		run.abort();
		const outcome = await pending;
		expect(outcome).toEqual({
			granted: false,
			reason: "cancelled",
			message: expect.any(String),
		});
	});

	test("an already-aborted run never surfaces a question", async () => {
		const clock = fakeClock();
		const run = new AbortController();
		run.abort();
		const questions: Fixture["questions"] = [];
		const broker = new ApprovalBroker({
			now: clock.now,
			scheduleTimeout: clock.scheduleTimeout,
			signal: run.signal,
			onRequest: (question) => questions.push(question),
		});
		const outcome = await broker.request(binding());
		expect(questions).toHaveLength(0);
		expect(outcome.granted).toBe(false);
	});
});

describe("grant validation at the boundary", () => {
	async function grantFixture() {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		return { grant: outcome.grant, broker };
	}

	test("altered canonical arguments fail the consumption check", async () => {
		const { grant } = await grantFixture();
		const consumption = grant.consume(
			binding({
				input: {
					stackName: "Renamed",
					option: { file: "cdk.out/manifest.json" },
				},
			}),
		);
		expect(consumption.ok).toBe(false);
	});

	test("an altered preview/plan digest fails the consumption check", async () => {
		const { grant } = await grantFixture();
		const consumption = grant.consume(
			binding({ planDigest: "sha256:repreviewed" }),
		);
		expect(consumption.ok).toBe(false);
	});

	test("an account refresh fails the consumption check", async () => {
		const { grant } = await grantFixture();
		const consumption = grant.consume(
			binding({ identity: { accountId: "999999999999", region: "us-east-1" } }),
		);
		expect(consumption.ok).toBe(false);
	});

	test("an altered project directory fails the consumption check", async () => {
		const { grant } = await grantFixture();
		expect(grant.consume(binding({ projectDir: "/other" })).ok).toBe(false);
	});

	test("an altered tool call id fails the consumption check", async () => {
		const { grant } = await grantFixture();
		expect(grant.consume(binding({ toolCallId: "call_2" })).ok).toBe(false);
	});

	test("an unused grant expires with the approval window", async () => {
		const { broker, questions, clock } = fixture();
		const pending = broker.request(binding());
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		clock.advance(APPROVAL_TIMEOUT_MS + 1);
		const consumption = outcome.grant.consume(binding());
		expect(consumption.ok).toBe(false);
		expect(broker.pendingCount).toBe(0);
	});

	test("a grant expires with the parent run/context when the run is cancelled", async () => {
		const { broker, questions, run } = fixture();
		const pending = broker.request(binding());
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		// The parent run cancels while the executor waits (for example on the
		// mutation permit); the un-consumed grant must not survive it.
		run.abort();
		expect(outcome.grant.consume(binding())).toEqual({
			ok: false,
			reason: "revoked",
			message: expect.any(String),
		});
	});

	test("a restart revokes outstanding grants and requests", async () => {
		const { broker, questions } = fixture();
		const pending = broker.request(binding());
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		broker.restart();
		const consumption = outcome.grant.consume(binding());
		expect(consumption.ok).toBe(false);
		// A recovered answer for the old request cannot execute anything either.
		await expect(
			broker.answer(approve(questions[0]?.requestId ?? "")),
		).rejects.toThrow();
		// The restarted broker approves nothing further: a new session must
		// construct a new broker and request fresh approval there.
		const questionsAfterRestart = questions.length;
		const outcomeAfterRestart = await broker.request(
			binding({ runId: "run_2" }),
		);
		expect(questions).toHaveLength(questionsAfterRestart);
		expect(outcomeAfterRestart.granted).toBe(false);
	});

	test("a truncated preview never reaches approval", async () => {
		const { broker, questions } = fixture();
		const outcome = await broker.request(binding({ previewComplete: false }));
		expect(questions).toHaveLength(0);
		expect(outcome).toEqual({
			granted: false,
			reason: "invalid",
			message: expect.any(String),
		});
	});
});

describe("generation writes cannot bypass the gate", () => {
	test("a specialist write follows the same bound flow; a bare write never happens", async () => {
		const { broker, questions } = fixture();
		const childBinding = binding({
			runId: "run_1",
			toolCallId: "call_child",
			toolName: "generate_project",
		});
		const writes: string[] = [];
		const executeWrite = async (grant: unknown, bind: ApprovalBinding) => {
			if (
				!grant ||
				typeof grant !== "object" ||
				!("consume" in grant) ||
				typeof (grant as { consume: unknown }).consume !== "function"
			) {
				throw new Error("no approval grant: refusing to write");
			}
			const consumption = (
				grant as {
					consume(b: ApprovalBinding): { ok: boolean; message?: string };
				}
			).consume(bind);
			if (!consumption.ok) throw new Error(consumption.message);
			writes.push(bind.toolName);
		};
		// Without any grant, the write refuses before touching the filesystem.
		await expect(executeWrite(undefined, childBinding)).rejects.toThrow(
			/refusing to write/,
		);
		expect(writes).toEqual([]);
		// Through the broker, the same child write is bound and consumed.
		const pending = broker.request(childBinding);
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pending;
		if (!outcome.granted) throw new Error("expected approval");
		await executeWrite(outcome.grant, childBinding);
		expect(writes).toEqual(["generate_project"]);
	});
});

// ---- Task 11: the freeform ask() seam (additive; questions never grant) ---- //

describe("freeform questions (ask seam)", () => {
	test("a freeform question surfaces with empty options and resolves with the exact text", async () => {
		const { broker, questions } = fixture();
		const pending = broker.ask("Which region should I scan?");
		expect(questions).toHaveLength(1);
		expect(questions[0]?.prompt).toBe("Which region should I scan?");
		expect(questions[0]?.options).toEqual([]);
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "text", value: "eu-central-1" },
		});
		expect(await pending).toEqual({ answered: true, text: "eu-central-1" });
	});

	test("an option answer to a freeform question is rejected, never a grant", async () => {
		const { broker, questions } = fixture();
		const pending = broker.ask("Continue?");
		await expect(
			broker.answer({
				requestId: questions[0]?.requestId ?? "",
				choice: { kind: "option", value: "approve" },
			}),
		).rejects.toThrow(/freeform/i);
		// Still answerable with text; no grant exists to consume anywhere.
		await broker.answer({
			requestId: questions[0]?.requestId ?? "",
			choice: { kind: "text", value: "yes" },
		});
		expect(await pending).toEqual({ answered: true, text: "yes" });
	});

	test("an unanswered freeform question expires without a grant", async () => {
		const { broker, clock, questions } = fixture();
		const pending = broker.ask("Hello?");
		clock.advance(APPROVAL_TIMEOUT_MS);
		expect(await pending).toEqual({
			answered: false,
			reason: "expired",
			message: expect.any(String),
		});
		expect(questions).toHaveLength(1);
	});

	test("a parent run cancel settles a pending freeform question", async () => {
		const { broker, run, questions } = fixture();
		const pending = broker.ask("Hello?");
		run.abort();
		expect(await pending).toEqual({
			answered: false,
			reason: "cancelled",
			message: expect.any(String),
		});
		expect(questions).toHaveLength(1);
	});

	test("a restart settles pending freeform questions without grants", async () => {
		const { broker, questions } = fixture();
		const pending = broker.ask("Hello?");
		broker.restart();
		expect(await pending).toEqual({
			answered: false,
			reason: "cancelled",
			message: expect.any(String),
		});
		expect(questions).toHaveLength(1);
	});

	test("an already-aborted run never surfaces a freeform question", async () => {
		const { broker, run, questions } = fixture();
		run.abort();
		const outcome = await broker.ask("Hello?");
		expect(questions).toHaveLength(0);
		expect(outcome).toEqual({
			answered: false,
			reason: "cancelled",
			message: expect.any(String),
		});
	});

	test("a freeform answer never reaches the grant/consume path", async () => {
		const { broker, questions } = fixture();
		const pendingApproval = broker.request(binding());
		const pendingQuestion = broker.ask("Freeform?");
		await broker.answer({
			requestId: questions[1]?.requestId ?? "",
			choice: { kind: "text", value: "the human's answer" },
		});
		expect(await pendingQuestion).toEqual({
			answered: true,
			text: "the human's answer",
		});
		// The approval is still pending and untouched by the question answer.
		await broker.answer(approve(questions[0]?.requestId ?? ""));
		const outcome = await pendingApproval;
		if (!outcome.granted) throw new Error("expected approval");
		expect(outcome.grant.consume(binding())).toEqual({ ok: true });
	});
});
