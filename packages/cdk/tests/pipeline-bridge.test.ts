import { describe, expect, test } from "bun:test";
import {
	buildPipelineBridge,
	type PipelineReconcilerKick,
} from "../src/reviewer/handlers/pipeline-bridge";
import { FakePipelineCoordinationStore } from "./pipeline-coordination-fakes";

const params = {
	pipelineExecutionId: "exec-1",
	pipelineName: "pipeline",
	stageName: "Build",
	actionName: "AIReview",
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
	generation: "3",
	sourceRevision: "a".repeat(40),
	destinationRevision: "b".repeat(40),
};

const event = (userParameters: string, id = "job-1") => ({
	"CodePipeline.job": {
		id,
		data: {
			actionConfiguration: {
				configuration: { UserParameters: userParameters },
			},
			artifactCredentials: {
				accessKeyId: "secret",
				secretAccessKey: "secret",
				sessionToken: "secret",
			},
			inputArtifacts: [{ name: "Source", location: { secret: "url" } }],
		},
	},
});

class RecordingKick implements PipelineReconcilerKick {
	readonly jobs: string[] = [];
	async invoke(jobId?: string): Promise<void> {
		if (jobId) this.jobs.push(jobId);
	}
}

describe("pipeline review bridge", () => {
	test("registers sanitized job metadata and kicks reconciliation", async () => {
		const store = new FakePipelineCoordinationStore();
		const kick = new RecordingKick();
		const bridge = buildPipelineBridge({
			store,
			reconciler: kick,
			timeoutMinutes: 60,
			clock: () => new Date("2026-07-29T12:00:00.000Z"),
		});

		await bridge(event(JSON.stringify(params)));

		expect(store.jobs.get("job-1")).toEqual({
			jobId: "job-1",
			state: "PENDING",
			pipelineExecutionId: "exec-1",
			pipelineName: "pipeline",
			stageName: "Build",
			actionName: "AIReview",
			request: {
				provider: "codecommit",
				repository: "orders",
				requestId: "42",
			},
			generation: 3,
			sourceRevision: "a".repeat(40),
			destinationRevision: "b".repeat(40),
			deadlineAt: "2026-07-29T13:00:00.000Z",
			nextActionAt: "2026-07-29T12:00:00.000Z",
		});
		expect(JSON.stringify(store.jobs.get("job-1"))).not.toContain("secret");
		expect(kick.jobs).toEqual(["job-1"]);
	});

	test("records a configuration failure when the job id is safe", async () => {
		const store = new FakePipelineCoordinationStore();
		const kick = new RecordingKick();
		const bridge = buildPipelineBridge({
			store,
			reconciler: kick,
			timeoutMinutes: 60,
			clock: () => new Date("2026-07-29T12:00:00.000Z"),
		});

		await bridge(event("not-json", "bad-job"));

		expect(store.jobs.get("bad-job")?.callbackCandidate).toEqual({
			status: "failure",
			category: "ConfigurationError",
			message: "Invalid CodePipeline review action configuration",
		});
		expect(kick.jobs).toEqual(["bad-job"]);
	});

	test("throws when no safe job id can be extracted", async () => {
		const bridge = buildPipelineBridge({
			store: new FakePipelineCoordinationStore(),
			reconciler: new RecordingKick(),
			timeoutMinutes: 60,
		});
		await expect(
			bridge({ "CodePipeline.job": { data: {} } }),
		).rejects.toBeDefined();
	});
});
