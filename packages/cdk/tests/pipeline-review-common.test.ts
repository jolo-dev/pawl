import { describe, expect, test } from "bun:test";
import {
	formatCiSummary,
	handlePipelineExecutionEvent,
	startPipelineForPr,
	type PipelineDispatchConfig,
	type PipelineExecutionSummary,
	type PipelineMappingStore,
	type PipelineTransport,
	type PrCommentPoster,
} from "../src/reviewer/pipeline-review-common";

function makeMockTransport(
	overrides: Partial<PipelineTransport> = {},
): PipelineTransport {
	return {
		startExecution: async () => ({ executionId: "exec-1" }),
		getExecution: async () => ({
			status: "Succeeded",
			stageSummaries: [],
		}),
		...overrides,
	};
}

function makeMockMappingStore(
	overrides: Partial<PipelineMappingStore> = {},
): PipelineMappingStore {
	const store = new Map<string, { pullRequestId: string; repositoryName: string; sourceCommitId: string; destinationCommitId: string }>();
	return {
		putMapping: async (params) => {
			store.set(params.executionId, {
				pullRequestId: params.pullRequestId,
				repositoryName: params.repositoryName,
				sourceCommitId: params.sourceCommitId,
				destinationCommitId: params.destinationCommitId,
			});
		},
		getMapping: async (executionId) => store.get(executionId),
		...overrides,
	};
}

function makeMockPoster(overrides: Partial<PrCommentPoster> = {}): PrCommentPoster {
	return {
		postComment: async () => {},
		...overrides,
	};
}

function makeConfig(overrides: Partial<PipelineDispatchConfig> = {}): PipelineDispatchConfig {
	return {
		pipelineTransport: makeMockTransport(),
		pipelineName: "my-pipeline",
		mappingStore: makeMockMappingStore(),
		commentPoster: makeMockPoster(),
		...overrides,
	};
}

describe("startPipelineForPr", () => {
	test("starts execution with sourceRevision and persists mapping", async () => {
		const startCalls: Array<{ pipelineName: string; sourceRevision?: string }> = [];
		const putCalls: Array<{ executionId: string; pullRequestId: string }> = [];
		const config = makeConfig({
			pipelineTransport: makeMockTransport({
				startExecution: async (params) => {
					startCalls.push(params);
					return { executionId: "exec-123" };
				},
			}),
			mappingStore: makeMockMappingStore({
				putMapping: async (params) => {
					putCalls.push(params);
				},
			}),
		});

		await startPipelineForPr(
			{
				pullRequestId: "pr-1",
				repositoryName: "my-repo",
				sourceCommitId: "abc123",
				destinationCommitId: "def456",
			},
			config,
		);

		expect(startCalls).toEqual([
			{ pipelineName: "my-pipeline", sourceRevision: "abc123" },
		]);
		expect(putCalls).toEqual([
			{
				executionId: "exec-123",
				pullRequestId: "pr-1",
				repositoryName: "my-repo",
				sourceCommitId: "abc123",
				destinationCommitId: "def456",
			},
		]);
	});

	test("is a no-op when pipelineTransport is undefined", async () => {
		const config = makeConfig({
			pipelineTransport: undefined,
			pipelineName: undefined,
		});
		// Should not throw
		await startPipelineForPr(
			{
				pullRequestId: "pr-1",
				repositoryName: "my-repo",
				sourceCommitId: "abc123",
				destinationCommitId: "def456",
			},
			config,
		);
	});
});

describe("handlePipelineExecutionEvent", () => {
	test("resolves mapping, fetches summary, and posts comment", async () => {
		const postedComments: Array<{ repositoryName: string; pullRequestId: string; content: string }> = [];
		const config = makeConfig({
			mappingStore: makeMockMappingStore({
				getMapping: async () => ({
					pullRequestId: "pr-1",
					repositoryName: "my-repo",
					sourceCommitId: "abc123",
					destinationCommitId: "def456",
				}),
			}),
			commentPoster: makeMockPoster({
				postComment: async (params) => {
					postedComments.push(params);
				},
			}),
		});

		await handlePipelineExecutionEvent(
			{ executionId: "exec-1", pipelineName: "my-pipeline" },
			config,
		);

		expect(postedComments).toHaveLength(1);
		expect(postedComments[0]!.pullRequestId).toBe("pr-1");
		expect(postedComments[0]!.content).toContain("Succeeded");
	});

	test("ignores events without a mapping", async () => {
		let postCalled = false;
		const config = makeConfig({
			mappingStore: makeMockMappingStore({
				getMapping: async () => undefined,
			}),
			commentPoster: makeMockPoster({
				postComment: async () => {
					postCalled = true;
				},
			}),
		});

		await handlePipelineExecutionEvent(
			{ executionId: "unknown", pipelineName: "my-pipeline" },
			config,
		);
		expect(postCalled).toBe(false);
	});

	test("does not post comment for InProgress status", async () => {
		let postCalled = false;
		const config = makeConfig({
			pipelineTransport: makeMockTransport({
				getExecution: async () => ({
					status: "InProgress",
					stageSummaries: [],
				}),
			}),
			mappingStore: makeMockMappingStore({
				getMapping: async () => ({
					pullRequestId: "pr-1",
					repositoryName: "my-repo",
					sourceCommitId: "abc",
					destinationCommitId: "def",
				}),
			}),
			commentPoster: makeMockPoster({
				postComment: async () => {
					postCalled = true;
				},
			}),
		});

		await handlePipelineExecutionEvent(
			{ executionId: "exec-1", pipelineName: "my-pipeline" },
			config,
		);
		expect(postCalled).toBe(false);
	});

	test("does not post comment for Stopping status", async () => {
		let postCalled = false;
		const config = makeConfig({
			pipelineTransport: makeMockTransport({
				getExecution: async () => ({
					status: "Stopping",
					stageSummaries: [],
				}),
			}),
			mappingStore: makeMockMappingStore({
				getMapping: async () => ({
					pullRequestId: "pr-1",
					repositoryName: "my-repo",
					sourceCommitId: "abc",
					destinationCommitId: "def",
				}),
			}),
			commentPoster: makeMockPoster({
				postComment: async () => {
					postCalled = true;
				},
			}),
		});

		await handlePipelineExecutionEvent(
			{ executionId: "exec-1", pipelineName: "my-pipeline" },
			config,
		);
		expect(postCalled).toBe(false);
	});

	test("posts comment for Superseded status", async () => {
		const postedComments: string[] = [];
		const config = makeConfig({
			pipelineTransport: makeMockTransport({
				getExecution: async () => ({
					status: "Superseded",
					stageSummaries: [],
				}),
			}),
			mappingStore: makeMockMappingStore({
				getMapping: async () => ({
					pullRequestId: "pr-1",
					repositoryName: "my-repo",
					sourceCommitId: "abc",
					destinationCommitId: "def",
				}),
			}),
			commentPoster: makeMockPoster({
				postComment: async (params) => {
					postedComments.push(params.content);
				},
			}),
		});

		await handlePipelineExecutionEvent(
			{ executionId: "exec-1", pipelineName: "my-pipeline" },
			config,
		);
		expect(postedComments).toHaveLength(1);
		expect(postedComments[0]).toContain("Superseded");
	});

	test("propagates mapping store failure", async () => {
		const config = makeConfig({
			mappingStore: makeMockMappingStore({
				getMapping: async () => {
					throw new Error("DynamoDB unavailable");
				},
			}),
		});

		try {
			await handlePipelineExecutionEvent(
				{ executionId: "exec-1", pipelineName: "my-pipeline" },
				config,
			);
			expect(false).toBe(true);
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(Error);
			expect((e as Error).message).toContain("DynamoDB unavailable");
		}
	});

	test("propagates comment poster failure", async () => {
		const config = makeConfig({
			mappingStore: makeMockMappingStore({
				getMapping: async () => ({
					pullRequestId: "pr-1",
					repositoryName: "my-repo",
					sourceCommitId: "abc",
					destinationCommitId: "def",
				}),
			}),
			commentPoster: makeMockPoster({
				postComment: async () => {
					throw new Error("CodeCommit API error");
				},
			}),
		});

		try {
			await handlePipelineExecutionEvent(
				{ executionId: "exec-1", pipelineName: "my-pipeline" },
				config,
			);
			expect(false).toBe(true);
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(Error);
			expect((e as Error).message).toContain("CodeCommit API error");
		}
	});
});

describe("formatCiSummary", () => {
	test("formats a succeeded summary with checkmark", () => {
		const summary: PipelineExecutionSummary = {
			status: "Succeeded",
			stageSummaries: [
				{
					stageName: "Source",
					actionStates: [{ actionName: "Source", status: "Succeeded" }],
				},
				{
					stageName: "Build",
					actionStates: [{ actionName: "Build", status: "Succeeded" }],
				},
			],
		};
		const result = formatCiSummary(summary);
		expect(result).toContain("✅");
		expect(result).toContain("Succeeded");
		expect(result).toContain("Source");
		expect(result).toContain("Build");
	});

	test("formats a failed summary with cross", () => {
		const summary: PipelineExecutionSummary = {
			status: "Failed",
			stageSummaries: [
				{
					stageName: "Build",
					actionStates: [{ actionName: "Build", status: "Failed" }],
				},
			],
		};
		const result = formatCiSummary(summary);
		expect(result).toContain("❌");
		expect(result).toContain("Failed");
	});
});
