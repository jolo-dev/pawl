import { describe, expect, test } from "bun:test";
import {
	buildEventRouter,
	handler,
} from "../../../../src/reviewer/handlers/router";
import type { PrPipelineDispatcher } from "../../../../src/reviewer/pipeline-review-common";
import type { SourceControlProvider } from "../../../../src/reviewer/ports/source-control-provider";
import type {
	LambdaCommand,
	LambdaTransport,
} from "../../../../src/reviewer/router/lambda-transport";
import { InMemoryStateStore } from "../../fakes/in-memory-state-store";

class RecordingPipelineDispatcher implements PrPipelineDispatcher {
	readonly starts: Array<{
		snapshot: typeof fakeReviewRequest;
		generation: number;
	}> = [];
	readonly terminals: Array<{
		request: typeof request;
		generation: number;
		status: "merged" | "closed";
	}> = [];

	async startReviewPipeline(input: {
		readonly snapshot: typeof fakeReviewRequest;
		readonly generation: number;
	}): Promise<void> {
		this.starts.push(input);
	}

	async completeTerminalRequest(input: {
		readonly request: typeof request;
		readonly generation: number;
		readonly status: "merged" | "closed";
	}): Promise<void> {
		this.terminals.push(input);
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

	test("starts a PR pipeline for authoritative open events but not comments", async () => {
		const store = new InMemoryStateStore();
		const lambda = new RecordingLambdaTransport();
		const pipelineDispatcher = new RecordingPipelineDispatcher();
		const router = buildEventRouter({
			stateStore: store,
			lambda,
			provider: fakeProvider,
			reviewerFunctionName: "test-reviewer-function",
			reviewerArn: "arn:aws:iam::123456789012:role/reviewer",
			pipelineDispatcher,
		});

		await router.routeCodeCommit(pullRequestCreatedEvent("repo"));
		await router.routeCodeCommit(
			commentEvent("arn:aws:iam::123456789012:user/human"),
		);

		expect(pipelineDispatcher.starts).toEqual([
			{ snapshot: fakeReviewRequest, generation: 1 },
		]);
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

	test("handler shape matches Pawl handlerFactory return (async (event) => ...)", () => {
		expect(typeof handler).toBe("function");
		expect(handler.length).toBe(1);
	});
});
