import { describe, expect, it } from "bun:test";
import {
	codePipelineJobEventSchema,
	parseSanitizedActionUserParameters,
	sanitizedActionUserParametersSchema,
} from "../src/reviewer/pipeline/codepipeline-job-event";
import {
	authoritativeRevisionRecordSchema,
	buildAuthoritativeRevisionKey,
	buildPipelineJobKey,
	buildRequestScopedJobIndexKey,
	buildReviewOutcomeKey,
	buildTerminalRequestKey,
	callbackFailureCategorySchema,
	callbackIntentSchema,
	jobStateSchema,
	selectCallbackIntent,
	terminalRequestRecordSchema,
} from "../src/reviewer/pipeline/pipeline-coordination-store";

const userParameters = {
	pipelineExecutionId: "pipe-exec-1",
	pipelineName: "orders-pipeline",
	stageName: "Review",
	actionName: "AIReview",
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
	generation: "3",
	sourceRevision: "a".repeat(40),
	destinationRevision: "b".repeat(40),
} as const;

const job = {
	jobId: "job-1",
	state: "PENDING",
	request: {
		provider: "codecommit",
		repository: "orders",
		requestId: "42",
	},
	generation: 3,
	sourceRevision: "a".repeat(40),
	deadlineAt: "2026-07-29T12:05:00.000Z",
} as const;

describe("CodePipeline job event schemas", () => {
	it("parses a safe envelope and sanitized user parameters only", () => {
		const parsed = codePipelineJobEventSchema.parse({
			"CodePipeline.job": {
				id: "job-1",
				accountId: "123456789012",
				data: {
					actionConfiguration: {
						configuration: {
							FunctionName: "bridge",
							UserParameters: JSON.stringify(userParameters),
						},
					},
					artifactCredentials: {
						accessKeyId: "secret",
						secretAccessKey: "secret",
						sessionToken: "secret",
					},
				},
			},
		});

		expect(parsed).toEqual({
			jobId: "job-1",
			userParameters: JSON.stringify(userParameters),
		});
		expect(Object.keys(parsed)).not.toContain("artifactCredentials");
		expect(parseSanitizedActionUserParameters(parsed.userParameters)).toEqual({
			...userParameters,
			generation: 3,
		});
	});

	it("rejects malformed and extra user parameter fields", () => {
		expect(() =>
			sanitizedActionUserParametersSchema.parse({
				...userParameters,
				generation: "not-a-number",
			}),
		).toThrow();
		expect(() =>
			sanitizedActionUserParametersSchema.parse({
				...userParameters,
				artifactCredentials: "raw",
			}),
		).toThrow();
		expect(() => parseSanitizedActionUserParameters("not-json")).toThrow();
	});
});

describe("pipeline coordination domain", () => {
	it("models only approved job states and callback categories", () => {
		expect(jobStateSchema.options).toEqual([
			"PENDING",
			"COMPLETING",
			"SUCCEEDED",
			"FAILED",
		]);
		expect(callbackFailureCategorySchema.options).toEqual([
			"ConfigurationError",
			"ReviewBlocked",
			"ReviewFailed",
			"Superseded",
			"TimedOut",
		]);
		expect(
			callbackIntentSchema.parse({
				status: "success",
				category: "ReviewSucceeded",
			}),
		).toEqual({
			status: "success",
			category: "ReviewSucceeded",
		});
		expect(() =>
			callbackIntentSchema.parse({
				status: "failure",
				category: "ReviewSucceeded",
			}),
		).toThrow();
	});

	it("builds and strictly validates terminal request markers by request generation", () => {
		expect(
			buildTerminalRequestKey({ request: job.request, generation: 3 }),
		).toEqual({
			pk: "TERMINAL_REQUEST#codecommit#orders#42#GEN#3",
			sk: "META",
		});
		expect(
			terminalRequestRecordSchema.parse({
				request: job.request,
				generation: 3,
				status: "merged",
				occurredAt: "2026-07-29T12:00:00.000Z",
			}),
		).toEqual({
			request: job.request,
			generation: 3,
			status: "merged",
			occurredAt: "2026-07-29T12:00:00.000Z",
		});
		expect(() =>
			terminalRequestRecordSchema.parse({
				request: job.request,
				generation: 3,
				status: "closed",
				occurredAt: "2026-07-29T12:00:00.000Z",
				secret: "not-approved",
			}),
		).toThrow();
	});

	it("strictly canonicalizes authoritative revision markers by request generation", () => {
		expect(
			buildAuthoritativeRevisionKey({ request: job.request, generation: 3 }),
		).toEqual({
			pk: "AUTHORITATIVE_REVISION#codecommit#orders#42#GEN#3",
			sk: "META",
		});
		expect(
			authoritativeRevisionRecordSchema.parse({
				request: job.request,
				generation: 3,
				sourceRevision: job.sourceRevision,
				observedAt: "2026-07-29T14:00:00+02:00",
				eventId: "revision-event",
			}),
		).toEqual({
			request: job.request,
			generation: 3,
			sourceRevision: job.sourceRevision,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "revision-event",
		});
		expect(() =>
			authoritativeRevisionRecordSchema.parse({
				request: job.request,
				generation: 3,
				sourceRevision: job.sourceRevision,
				observedAt: "2026-07-29T12:00:00.000Z",
				eventId: "revision-event",
				secret: "not-approved",
			}),
		).toThrow();
	});

	it("builds pure table keys with generation in the outcome identity", () => {
		expect(buildPipelineJobKey("job-1")).toEqual({
			pk: "PIPELINE_JOB#job-1",
			sk: "META",
		});
		expect(
			buildReviewOutcomeKey({
				request: job.request,
				generation: 3,
				sourceRevision: job.sourceRevision,
			}),
		).toEqual({
			pk: "REVIEW_OUTCOME#codecommit#orders#42#GEN#3",
			sk: `REVISION#${job.sourceRevision}`,
		});
	});

	it("encodes key segments to avoid delimiter collisions", () => {
		const firstRequest = {
			provider: "codecommit",
			repository: "a#b",
			requestId: "c",
		} as const;
		const first = buildReviewOutcomeKey({
			request: firstRequest,
			generation: 3,
			sourceRevision: "abc1234#rev",
		});
		const second = buildReviewOutcomeKey({
			request: { provider: "codecommit", repository: "a", requestId: "b#c" },
			generation: 3,
			sourceRevision: "abc1234#rev",
		});

		expect(first.pk).not.toBe(second.pk);
		expect(first.pk).toContain("a%23b");
		expect(first.sk).toContain("abc1234%23rev");
		expect(
			buildRequestScopedJobIndexKey({
				request: firstRequest,
				generation: 3,
				sourceRevision: "abc1234#rev",
				jobId: "job#1",
			}),
		).toEqual({
			gsiPk: "REQUEST#codecommit#a%23b#c#GEN#3",
			gsiSk: "REVISION#abc1234%23rev#JOB#job%231",
		});
	});

	it("selects callback intents by immutable precedence", () => {
		const existingFailure = {
			status: "failure",
			category: "ReviewFailed",
		} as const;
		expect(
			selectCallbackIntent({
				job: { ...job, state: "COMPLETING", terminalIntent: existingFailure },
				superseded: true,
				now: "2026-07-29T12:10:00.000Z",
			}),
		).toEqual(existingFailure);

		expect(selectCallbackIntent({ job, superseded: true })).toEqual({
			status: "failure",
			category: "Superseded",
		});

		expect(
			selectCallbackIntent({
				job,
				outcome: {
					request: job.request,
					generation: 3,
					sourceRevision: job.sourceRevision,
					status: "reviewed",
					checkStatus: "completed",
				},
				now: "2026-07-29T12:10:00.000Z",
			}),
		).toEqual({ status: "success", category: "ReviewSucceeded" });

		expect(
			selectCallbackIntent({
				job,
				terminalRequestState: "merged",
				now: "2026-07-29T12:10:00.000Z",
			}),
		).toEqual({ status: "success", category: "RequestMerged" });

		expect(
			selectCallbackIntent({ job, now: "2026-07-29T12:10:00.000Z" }),
		).toEqual({
			status: "failure",
			category: "TimedOut",
		});
		expect(
			selectCallbackIntent({ job, now: "2026-07-29T12:00:00.000Z" }),
		).toBeUndefined();
	});

	it("preserves persisted supersession ahead of a late matching outcome", () => {
		expect(
			selectCallbackIntent({
				job: {
					...job,
					callbackCandidate: {
						status: "failure",
						category: "Superseded",
					},
				},
				outcome: {
					request: job.request,
					generation: job.generation,
					sourceRevision: job.sourceRevision,
					status: "reviewed",
					checkStatus: "completed",
				},
			}),
		).toEqual({ status: "failure", category: "Superseded" });
	});

	it.each([
		["success", "ReviewSucceeded"],
		["success", "RequestMerged"],
		["success", "RequestClosed"],
		["failure", "ConfigurationError"],
		["failure", "ReviewBlocked"],
		["failure", "ReviewFailed"],
		["failure", "TimedOut"],
	] as const)("keeps persisted %s/%s candidate behind a matching successful outcome", (status, category) => {
		expect(
			selectCallbackIntent({
				job: {
					...job,
					callbackCandidate: { status, category },
				},
				outcome: {
					request: job.request,
					generation: job.generation,
					sourceRevision: job.sourceRevision,
					status: "reviewed",
					checkStatus: "completed",
				},
			}),
		).toEqual({ status: "success", category: "ReviewSucceeded" });
	});

	it("does not let merge or close overwrite completing jobs or existing failure intents", () => {
		expect(
			selectCallbackIntent({
				job: {
					...job,
					state: "COMPLETING",
					terminalIntent: { status: "failure", category: "ReviewFailed" },
				},
				terminalRequestState: "closed",
			}),
		).toEqual({ status: "failure", category: "ReviewFailed" });

		expect(
			selectCallbackIntent({
				job: { ...job, state: "COMPLETING" },
				terminalRequestState: "merged",
			}),
		).toBeUndefined();

		expect(
			selectCallbackIntent({
				job: {
					...job,
					callbackCandidate: { status: "success", category: "ReviewSucceeded" },
				},
				terminalRequestState: "closed",
			}),
		).toEqual({ status: "success", category: "ReviewSucceeded" });
	});

	it("requires matching generation before consuming an outcome", () => {
		expect(
			selectCallbackIntent({
				job,
				outcome: {
					request: job.request,
					generation: 2,
					sourceRevision: job.sourceRevision,
					status: "reviewed",
					checkStatus: "completed",
				},
			}),
		).toBeUndefined();
	});
});
