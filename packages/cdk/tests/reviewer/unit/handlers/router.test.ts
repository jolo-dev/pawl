import { describe, expect, test } from "bun:test";
import { StartPipelineExecutionCommand } from "@aws-sdk/client-codepipeline";
import {
	AwsCodePipelineTransport,
	type CodePipelineCommand,
	type CodePipelineCommandSender,
} from "../../../../src/reviewer/adapters/codepipeline-transport";
import {
	buildEventRouter,
	handler,
} from "../../../../src/reviewer/handlers/router";
import {
	type ExactPipelineTransport,
	PipelineReviewDispatcher,
} from "../../../../src/reviewer/pipeline-review-common";
import type { SourceControlProvider } from "../../../../src/reviewer/ports/source-control-provider";
import type {
	LambdaCommand,
	LambdaTransport,
} from "../../../../src/reviewer/router/lambda-transport";
import { PipelineEventRouter } from "../../../../src/reviewer/router/pipeline-event-router";
import { FakePipelineCoordinationStore } from "../../../pipeline-coordination-fakes";
import { InMemoryStateStore } from "../../fakes/in-memory-state-store";

class IdempotentPipelineSender implements CodePipelineCommandSender {
	readonly starts: StartPipelineExecutionCommand[] = [];
	readonly executionsByToken = new Map<string, string>();
	readonly #failFirst: boolean;

	constructor(options: { readonly failFirst?: boolean } = {}) {
		this.#failFirst = options.failFirst ?? false;
	}

	async send(command: CodePipelineCommand): Promise<unknown> {
		if (!(command instanceof StartPipelineExecutionCommand)) return {};
		this.starts.push(command);
		if (this.#failFirst && this.starts.length === 1) {
			throw new Error("simulated dispatch failure");
		}
		const token = command.input.clientRequestToken;
		if (token === undefined) throw new Error("expected client request token");
		const executionId =
			this.executionsByToken.get(token) ??
			`execution-${this.executionsByToken.size + 1}`;
		this.executionsByToken.set(token, executionId);
		return { pipelineExecutionId: executionId };
	}
}

class RecordingReconciler {
	count = 0;

	async invoke(): Promise<void> {
		this.count += 1;
	}
}

class RecordingLambdaTransport implements LambdaTransport {
	readonly commands: LambdaCommand[] = [];

	async send(command: LambdaCommand): Promise<unknown> {
		this.commands.push(command);
		return {
			DurableExecutionArn:
				"arn:aws:lambda:us-east-1:123456789012:durable-execution:execution-1",
		};
	}
}

const request = {
	provider: "codecommit",
	repository: "repo",
	requestId: "7",
} as const;

const fakeReviewRequest = {
	key: request,
	title: "Test pull request",
	status: "open",
	sourceBranch: "refs/heads/feature",
	destinationBranch: "refs/heads/main",
	sourceRevision: "source-immutable-commit-1234567",
	destinationRevision: "destination-immutable-commit-1234567",
};

const fakeProvider = {
	getRequest: async () => fakeReviewRequest,
} as unknown as SourceControlProvider;

function pullRequestCreatedEvent(repositoryName: string): unknown {
	return {
		id: "event-1",
		time: "2026-01-01T00:00:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName,
			pullRequestId: "7",
			event: "pullRequestCreated",
		},
	};
}

function commentEvent(authorArn: string): unknown {
	return {
		id: "comment-event-1",
		time: "2026-01-01T00:00:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Comment on Pull Request",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event: "commentOnPullRequestCreated",
			commentId: "comment-1",
			callerUserArn: authorArn,
		},
	};
}

function pullRequestReopenedEvent(): unknown {
	return {
		id: "event-reopened",
		time: "2026-01-01T00:01:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event: "pullRequestStatusChanged",
			pullRequestStatus: "OPEN",
		},
	};
}

function terminalRequestEvent(status: "merged" | "closed"): unknown {
	return {
		id: `event-${status}`,
		time: "2026-01-01T00:02:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event:
				status === "merged" ? "pullRequestMerged" : "pullRequestStatusChanged",
			...(status === "closed" ? { pullRequestStatus: "CLOSED" } : {}),
		},
	};
}

function revisionUpdatedEvent(id: string, sourceCommit: string): unknown {
	return {
		id,
		time: "2026-01-01T00:01:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event: "pullRequestSourceBranchUpdated",
			sourceCommit,
			destinationCommit: fakeReviewRequest.destinationRevision,
		},
	};
}

function pipelineDispatcher(transport: ExactPipelineTransport) {
	return new PipelineReviewDispatcher({
		pipelineName: "review-pipeline",
		transport,
		store: new FakePipelineCoordinationStore(),
		reconciler: new RecordingReconciler(),
	});
}

function pendingPipelineJob(jobId: string) {
	return {
		jobId,
		state: "PENDING" as const,
		pipelineExecutionId: `execution-${jobId}`,
		pipelineName: "review-pipeline",
		stageName: "Review",
		actionName: "AIReview",
		request,
		generation: 1,
		sourceRevision: fakeReviewRequest.sourceRevision,
		destinationRevision: fakeReviewRequest.destinationRevision,
		deadlineAt: "2026-01-01T01:00:00.000Z",
		nextActionAt: "2026-01-01T00:05:00.000Z",
	};
}

function expectPipelineStart(
	command: StartPipelineExecutionCommand | undefined,
	generation: number,
): void {
	expect(command?.input).toMatchObject({
		name: "review-pipeline",
		clientRequestToken: expect.any(String),
		sourceRevisions: [
			{
				actionName: "Source",
				revisionType: "COMMIT_ID",
				revisionValue: fakeReviewRequest.sourceRevision,
			},
		],
		variables: [
			{ name: "PAWL_PROVIDER", value: "codecommit" },
			{ name: "PAWL_REPOSITORY", value: "repo" },
			{ name: "PAWL_REQUEST_ID", value: "7" },
			{ name: "PAWL_GENERATION", value: String(generation) },
			{
				name: "PAWL_SOURCE_REVISION",
				value: fakeReviewRequest.sourceRevision,
			},
			{
				name: "PAWL_DESTINATION_REVISION",
				value: fakeReviewRequest.destinationRevision,
			},
		],
	});
}

describe("router", () => {
	test("routes a normal CodeCommit PR event end-to-end through buildEventRouter", async () => {
		const store = new InMemoryStateStore();
		const lambda = new RecordingLambdaTransport();
		const router = buildEventRouter({
			stateStore: store,
			lambda,
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
		});

		const result = await router.routeCodeCommit(
			pullRequestCreatedEvent("repo"),
		);

		expect(result).not.toBeUndefined();
		expect(result?.appended).toBe(true);
		expect(result?.started).toBe(true);
		expect(result?.durableExecutionArn).toBe(
			"arn:aws:lambda:us-east-1:123456789012:durable-execution:execution-1",
		);
		expect(store.inspectRequest(request)?.lifecycleState).toBe("RUNNING");

		expect(lambda.commands).toHaveLength(1);
		expect(lambda.commands[0]?.kind).toBe("invoke");
		if (lambda.commands[0]?.kind !== "invoke")
			throw new Error("expected invoke command");
		expect(lambda.commands[0].input.FunctionName).toBe(
			"test-reviewer-function",
		);
		expect(lambda.commands[0].input.Qualifier).toBe("live");
	});

	test("starts the exact authoritative open revision but not a human comment", async () => {
		const sender = new IdempotentPipelineSender();
		const router = buildEventRouter({
			stateStore: new InMemoryStateStore(),
			lambda: new RecordingLambdaTransport(),
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher: pipelineDispatcher(
				new AwsCodePipelineTransport(sender),
			),
		});

		await router.routeCodeCommit(pullRequestCreatedEvent("repo"));
		await router.routeCodeCommit(
			commentEvent("arn:aws:iam::123456789012:user/human"),
		);

		expect(sender.starts).toHaveLength(1);
		expectPipelineStart(sender.starts[0], 1);
	});

	test("starts the authoritative revision when a pull request is reopened", async () => {
		const store = new InMemoryStateStore();
		const sender = new IdempotentPipelineSender();
		const router = buildEventRouter({
			stateStore: store,
			lambda: new RecordingLambdaTransport(),
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher: pipelineDispatcher(
				new AwsCodePipelineTransport(sender),
			),
		});

		await router.routeCodeCommit(pullRequestCreatedEvent("repo"));
		await store.claimEvents(request, 1);
		await store.complete(request, 1, { type: "closed" });
		await router.routeCodeCommit(pullRequestReopenedEvent());

		expect(sender.starts).toHaveLength(2);
		expectPipelineStart(sender.starts[0], 1);
		expectPipelineStart(sender.starts[1], 2);
	});

	test("does not start a pipeline for a stale revision after authoritative refetch", async () => {
		const sender = new IdempotentPipelineSender();
		let refetches = 0;
		const router = buildEventRouter({
			stateStore: new InMemoryStateStore(),
			lambda: new RecordingLambdaTransport(),
			provider: {
				getRequest: async () => {
					refetches += 1;
					return fakeReviewRequest;
				},
			} as SourceControlProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher: pipelineDispatcher(
				new AwsCodePipelineTransport(sender),
			),
		});

		await router.routeCodeCommit(
			revisionUpdatedEvent("event-stale", "stale-source-commit-1234567"),
		);

		expect(refetches).toBe(1);
		expect(sender.starts).toHaveLength(0);
	});

	test("uses one semantic pipeline execution for a duplicate delivery", async () => {
		const sender = new IdempotentPipelineSender();
		const router = buildEventRouter({
			stateStore: new InMemoryStateStore(),
			lambda: new RecordingLambdaTransport(),
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher: pipelineDispatcher(
				new AwsCodePipelineTransport(sender),
			),
		});
		const delivery = revisionUpdatedEvent(
			"event-current-revision",
			fakeReviewRequest.sourceRevision,
		);

		await router.routeCodeCommit(delivery);
		await router.routeCodeCommit(delivery);

		expect(sender.starts).toHaveLength(2);
		expect(sender.starts[1]?.input).toEqual(sender.starts[0]?.input);
		expectPipelineStart(sender.starts[0], 1);
		expect(sender.executionsByToken).toHaveLength(1);
	});

	test("retries pipeline dispatch when the first delivery fails after append", async () => {
		const sender = new IdempotentPipelineSender({ failFirst: true });
		const router = buildEventRouter({
			stateStore: new InMemoryStateStore(),
			lambda: new RecordingLambdaTransport(),
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher: pipelineDispatcher(
				new AwsCodePipelineTransport(sender),
			),
		});
		const delivery = revisionUpdatedEvent(
			"event-retry-revision",
			fakeReviewRequest.sourceRevision,
		);

		await expect(router.routeCodeCommit(delivery)).rejects.toThrow(
			"simulated dispatch failure",
		);
		await expect(router.routeCodeCommit(delivery)).resolves.toMatchObject({
			appended: false,
		});

		expect(sender.starts).toHaveLength(2);
		expect(sender.starts[1]?.input.clientRequestToken).toBe(
			sender.starts[0]?.input.clientRequestToken,
		);
		expect(sender.executionsByToken).toHaveLength(1);
	});

	test.each([
		["merged", "RequestMerged"],
		["closed", "RequestClosed"],
	] as const)("routes a %s request through the production dispatcher without starting a pipeline", async (status, category) => {
		const coordinationStore = new FakePipelineCoordinationStore();
		await coordinationStore.registerJob(pendingPipelineJob("pending"));
		await coordinationStore.registerJob({
			...pendingPipelineJob("already-selected"),
			callbackCandidate: {
				status: "failure",
				category: "ReviewBlocked",
			},
		});
		await coordinationStore.registerJob({
			...pendingPipelineJob("completing"),
			state: "COMPLETING",
			terminalIntent: {
				status: "failure",
				category: "ReviewFailed",
			},
			completionLeaseExpiresAt: "2026-01-01T00:10:00.000Z",
		});
		const sender = new IdempotentPipelineSender();
		const reconciler = new RecordingReconciler();
		const router = buildEventRouter({
			stateStore: new InMemoryStateStore(),
			lambda: new RecordingLambdaTransport(),
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher: new PipelineReviewDispatcher({
				pipelineName: "review-pipeline",
				transport: new AwsCodePipelineTransport(sender),
				store: coordinationStore,
				reconciler,
			}),
		});

		await router.routeCodeCommit(terminalRequestEvent(status));

		expect(sender.starts).toHaveLength(0);
		expect(coordinationStore.jobs.get("pending")?.callbackCandidate).toEqual({
			status: "success",
			category,
		});
		expect(
			coordinationStore.jobs.get("already-selected")?.callbackCandidate,
		).toEqual({
			status: "failure",
			category: "ReviewBlocked",
		});
		expect(coordinationStore.jobs.get("completing")).toMatchObject({
			state: "COMPLETING",
			terminalIntent: {
				status: "failure",
				category: "ReviewFailed",
			},
		});
		expect(
			coordinationStore.jobs.get("completing")?.callbackCandidate,
		).toBeUndefined();
		expect(reconciler.count).toBe(1);
	});

	test("drops reviewer-self comment events without invoking Lambda", async () => {
		const store = new InMemoryStateStore();
		const lambda = new RecordingLambdaTransport();
		const reviewerArn = "arn:aws:iam::123456789012:role/reviewer";
		const router = buildEventRouter({
			stateStore: store,
			lambda,
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn,
		});

		const result = await router.routeCodeCommit(commentEvent(reviewerArn));

		expect(result).toBeUndefined();
		expect(lambda.commands).toHaveLength(0);
	});

	test("builds pipeline-only mode without reviewer function environment", () => {
		const previous = { ...process.env };
		try {
			process.env.STATE_TABLE_NAME = "state";
			process.env.PIPELINE_NAME = "review-pipeline";
			process.env.PIPELINE_SOURCE_ACTION_NAME = "Source";
			delete process.env.REVIEWER_FUNCTION_NAME;
			delete process.env.REVIEWER_FUNCTION_ARN;
			delete process.env.RECONCILER_FUNCTION_NAME;

			expect(buildEventRouter()).toBeInstanceOf(PipelineEventRouter);
		} finally {
			process.env = previous;
		}
	});

	test("fails fast when pipeline-only mode omits its source action", () => {
		const previous = { ...process.env };
		try {
			process.env.STATE_TABLE_NAME = "state";
			process.env.PIPELINE_NAME = "review-pipeline";
			delete process.env.PIPELINE_SOURCE_ACTION_NAME;
			delete process.env.REVIEWER_FUNCTION_NAME;
			delete process.env.REVIEWER_FUNCTION_ARN;

			expect(() => buildEventRouter()).toThrow(
				"PIPELINE_SOURCE_ACTION_NAME environment variable is required",
			);
		} finally {
			process.env = previous;
		}
	});

	test("fails fast on partial reviewed-mode environment", () => {
		const previous = { ...process.env };
		try {
			process.env.STATE_TABLE_NAME = "state";
			process.env.REVIEWER_FUNCTION_NAME = "reviewer";
			delete process.env.REVIEWER_FUNCTION_ARN;
			delete process.env.PIPELINE_NAME;

			expect(() => buildEventRouter()).toThrow(
				"REVIEWER_FUNCTION_ARN environment variable is required",
			);
		} finally {
			process.env = previous;
		}
	});

	test("handler shape matches Pawl handlerFactory return (async (event) => ...)", () => {
		expect(typeof handler).toBe("function");
		expect(handler.length).toBe(1);
	});
});
