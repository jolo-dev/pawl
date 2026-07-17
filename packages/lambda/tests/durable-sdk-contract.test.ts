import { expect, test } from "bun:test";
import {
	type DurableContext,
	withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
	LocalDurableTestRunner,
	WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

type ReviewEvent = {
	commit: string;
	review: string;
};

const handler = withDurableExecution(
	async (event: ReviewEvent, context: DurableContext): Promise<string> => {
		const review = await context.step("load", async () => event.review);

		await context.wait("debounce", { seconds: 1 });

		const commit = await context.waitForCallback<string>(
			"request-event",
			async (_callbackId) => {},
			{ timeout: { minutes: 1 } },
		);

		return `${review}:${commit}`;
	},
);

test("the pinned durable SDK completes a callback workflow locally", async () => {
	await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });

	try {
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });
		const executionPromise = runner.run({
			payload: { commit: "commit", review: "review" },
		});
		const callback = runner.getOperation("request-event");

		await callback.waitForData(WaitingOperationStatus.SUBMITTED);
		await callback.sendCallbackSuccess("commit");

		const execution = await executionPromise;
		const load = runner.getOperation("load");
		const debounce = runner.getOperation("debounce");

		expect(load.getStepDetails().result).toBe("review");
		expect(debounce.getWaitDetails().waitSeconds).toBe(1);
		expect(execution.getStatus()).toBe("SUCCEEDED");
		expect(execution.getResult()).toBe("review:commit");
	} finally {
		await LocalDurableTestRunner.teardownTestEnvironment();
	}
});
