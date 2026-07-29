import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { useEventbridgeHandler } from "@pawl/lambda";
import { AwsCodePipelineTransport } from "../adapters/codepipeline-transport";
import { DynamoDbPipelineCoordinationStore } from "../adapters/dynamodb-pipeline-coordination-store";
import {
	type CallbackIntent,
	type PipelineJobRecord,
	selectCallbackIntent,
} from "../pipeline/pipeline-coordination-store";
import type { PipelineCoordinationStore } from "../ports/pipeline-coordination-store";

export interface PipelineJobResultTransport {
	putJobSuccess(jobId: string): Promise<void>;
	putJobFailure(input: {
		readonly jobId: string;
		readonly category: string;
		readonly message: string;
	}): Promise<void>;
}

export interface PipelineReconcilerOptions {
	readonly store: PipelineCoordinationStore;
	readonly transport: PipelineJobResultTransport;
	readonly clock?: () => Date;
	readonly leaseMinutes?: number;
}

const addMinutes = (date: Date, minutes: number): string =>
	new Date(date.getTime() + minutes * 60_000).toISOString();

const isAlreadyCompleted = (error: unknown): boolean => {
	if (typeof error !== "object" || error === null) return false;
	const name = (error as Record<string, unknown>).name;
	return name === "InvalidJobStateException" || name === "JobNotFoundException";
};

const callbackMessage = (intent: CallbackIntent): string =>
	(intent.message ?? intent.category).slice(0, 1_000);

export const buildPipelineReconciler = (options: PipelineReconcilerOptions) => {
	const clock = options.clock ?? (() => new Date());
	const leaseMinutes = options.leaseMinutes ?? 2;

	const complete = async (job: PipelineJobRecord): Promise<void> => {
		const now = clock();
		const nowText = now.toISOString();
		let claimed: PipelineJobRecord | undefined;
		if (job.state === "PENDING") {
			const outcome = await options.store.getOutcome(job);
			const intent = selectCallbackIntent({ job, outcome, now: nowText });
			if (intent === undefined) {
				await options.store.reschedule(job.jobId, addMinutes(now, 1));
				return;
			}
			claimed = await options.store.claimCompletion({
				jobId: job.jobId,
				intent,
				leaseExpiresAt: addMinutes(now, leaseMinutes),
				nextActionAt: addMinutes(now, leaseMinutes),
			});
		} else if (job.state === "COMPLETING" && job.terminalIntent !== undefined) {
			if (
				job.completionLeaseExpiresAt !== undefined &&
				Date.parse(job.completionLeaseExpiresAt) > now.getTime()
			) {
				return;
			}
			claimed = await options.store.reclaimCompletion({
				jobId: job.jobId,
				intent: job.terminalIntent,
				now: nowText,
				leaseExpiresAt: addMinutes(now, leaseMinutes),
				nextActionAt: addMinutes(now, leaseMinutes),
			});
		}
		if (claimed?.terminalIntent === undefined) return;
		const intent = claimed.terminalIntent;
		try {
			if (intent.status === "success") {
				await options.transport.putJobSuccess(claimed.jobId);
			} else {
				await options.transport.putJobFailure({
					jobId: claimed.jobId,
					category: intent.category,
					message: callbackMessage(intent),
				});
			}
		} catch (error) {
			if (!isAlreadyCompleted(error)) throw error;
		}
		await options.store.finishCompletion(claimed.jobId, intent);
	};

	return async (jobId?: string): Promise<void> => {
		if (jobId !== undefined) {
			const job = await options.store.getJob(jobId);
			if (job !== undefined) await complete(job);
			return;
		}
		const now = clock().toISOString();
		for (const state of ["PENDING", "COMPLETING"] as const) {
			let cursor: Readonly<Record<string, unknown>> | undefined;
			do {
				const page = await options.store.listDueJobs(state, now, cursor);
				for (const job of page.jobs) {
					try {
						await complete(job);
					} catch (error) {
						console.error(
							"pipeline review reconciliation failed",
							job.jobId,
							error,
						);
					}
				}
				cursor = page.cursor;
			} while (cursor !== undefined);
		}
	};
};

const buildFromEnvironment = (): PipelineReconcilerOptions => {
	const tableName = process.env.STATE_TABLE_NAME;
	if (!tableName)
		throw new Error("pipeline reconciler requires STATE_TABLE_NAME");
	return {
		store: new DynamoDbPipelineCoordinationStore({
			transport: DynamoDBDocumentClient.from(new DynamoDBClient({})),
			tableName,
		}),
		transport: new AwsCodePipelineTransport(),
	};
};

let cachedReconciler: ReturnType<typeof buildPipelineReconciler> | undefined;

export const handler = useEventbridgeHandler<
	"Pipeline Review Reconcile",
	{ readonly jobId?: string },
	void
>("pipeline-review-reconciler", async (event) => {
	cachedReconciler ??= buildPipelineReconciler(buildFromEnvironment());
	await cachedReconciler(event.detail.jobId);
});
