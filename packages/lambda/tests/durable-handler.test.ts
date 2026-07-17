import {
	afterAll,
	beforeAll,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import {
	LocalDurableTestRunner,
	WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
	type DurableRequestHandler,
	useDurableHandler,
} from "../src/durable-handler";

type WorkflowEvent = {
	jobId: string;
	payload: {
		secret: string;
		value: string;
	};
};

type WorkflowResult = {
	jobId: string;
	result: string;
};

const nestedSecret = "NEVER_LOG_DURABLE_INPUT_7d91d0";
const loggerCalls: unknown[][] = [];
const appendKeyCalls: unknown[][] = [];
const removeKeyCalls: unknown[][] = [];
const loggerSpies: Array<{ mockRestore: () => void }> = [];

const recordLoggerCall = (...parameters: unknown[]) => {
	loggerCalls.push(parameters);
};

describe.serial("durable-handler", () => {
	beforeAll(async () => {
		loggerSpies.push(
			spyOn(Logger.prototype, "debug").mockImplementation(recordLoggerCall),
			spyOn(Logger.prototype, "error").mockImplementation(recordLoggerCall),
			spyOn(Logger.prototype, "info").mockImplementation(recordLoggerCall),
			spyOn(Logger.prototype, "warn").mockImplementation(recordLoggerCall),
			spyOn(Logger.prototype, "appendKeys").mockImplementation(
				(...parameters: unknown[]) => {
					appendKeyCalls.push(parameters);
				},
			),
			spyOn(Logger.prototype, "removeKeys").mockImplementation(
				(...parameters: unknown[]) => {
					removeKeyCalls.push(parameters);
				},
			),
		);
		await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
	});

	afterAll(async () => {
		await LocalDurableTestRunner.teardownTestEnvironment();
		for (const loggerSpy of loggerSpies) {
			loggerSpy.mockRestore();
		}
	});

	test("runs a typed step and callback workflow with shared Powertools utilities", async () => {
		const utilitySnapshots: Array<{
			logger: Logger;
			metrics: Metrics;
			tracer: Tracer;
		}> = [];
		const durableExecutionArns: string[] = [];
		const publishStoredMetrics = mock(function (this: Metrics) {
			return this;
		});

		const handleRequest: DurableRequestHandler<
			WorkflowEvent,
			WorkflowResult
		> = async (event, context, utilities) => {
			utilitySnapshots.push(utilities);
			durableExecutionArns.push(context.executionContext.durableExecutionArn);
			utilities.metrics.publishStoredMetrics = publishStoredMetrics;
			utilities.metrics.addMetric("WorkflowRuns", MetricUnit.Count, 1);

			const loaded = await context.step(
				"load",
				async () => event.payload.value,
			);
			const callbackResult = await context.waitForCallback<string>(
				"request-event",
				async () => {},
			);

			return {
				jobId: event.jobId,
				result: `${loaded}:${callbackResult}`,
			};
		};
		const handler: DurableLambdaHandler = useDurableHandler(
			"durable-test",
			handleRequest,
		);
		const runner = new LocalDurableTestRunner<WorkflowResult>({
			handlerFunction: handler,
		});
		const executionPromise = runner.run({
			payload: {
				jobId: "job-42",
				payload: { secret: nestedSecret, value: "loaded" },
			} satisfies WorkflowEvent,
		});
		const callback = runner.getOperation("request-event");

		await callback.waitForData(WaitingOperationStatus.SUBMITTED);
		await callback.sendCallbackSuccess("approved");
		const execution = await executionPromise;
		const warmRunner = new LocalDurableTestRunner<WorkflowResult>({
			handlerFunction: handler,
		});
		const warmExecutionPromise = warmRunner.run({
			payload: {
				jobId: "job-43",
				payload: { secret: nestedSecret, value: "warm" },
			} satisfies WorkflowEvent,
		});
		const warmCallback = warmRunner.getOperation("request-event");
		await warmCallback.waitForData(WaitingOperationStatus.SUBMITTED);
		await warmCallback.sendCallbackSuccess("accepted");
		const warmExecution = await warmExecutionPromise;
		const invocationCount =
			execution.getInvocations().length + warmExecution.getInvocations().length;

		expect(execution.getStatus()).toBe("SUCCEEDED");
		expect(execution.getResult()).toEqual({
			jobId: "job-42",
			result: "loaded:approved",
		});
		expect(runner.getOperation("load").getStepDetails()?.result).toBe("loaded");
		expect(callback.getCallbackDetails()?.result).toBe("approved");
		expect(execution.getOperations()).toHaveLength(4);
		expect(warmExecution.getStatus()).toBe("SUCCEEDED");
		expect(warmExecution.getResult()).toEqual({
			jobId: "job-43",
			result: "warm:accepted",
		});
		expect(
			execution
				.getOperations()
				.filter((operation) => operation.getName() === "load"),
		).toHaveLength(1);
		expect(
			execution
				.getOperations()
				.filter((operation) => operation.getName() === "request-event"),
		).toHaveLength(1);
		expect(invocationCount).toBeGreaterThan(2);
		expect(utilitySnapshots).toHaveLength(invocationCount);

		expect(new Set(utilitySnapshots.map(({ logger }) => logger)).size).toBe(1);
		expect(new Set(utilitySnapshots.map(({ tracer }) => tracer)).size).toBe(1);
		expect(new Set(utilitySnapshots.map(({ metrics }) => metrics)).size).toBe(
			1,
		);
		expect(utilitySnapshots[0]?.logger).toBeInstanceOf(Logger);
		expect(utilitySnapshots[0]?.tracer).toBeInstanceOf(Tracer);
		expect(utilitySnapshots[0]?.metrics).toBeInstanceOf(Metrics);
		expect(publishStoredMetrics).toHaveBeenCalledTimes(invocationCount);

		const uniqueArns = new Set(durableExecutionArns);
		expect(uniqueArns.size).toBe(2);
		for (const durableExecutionArn of uniqueArns) {
			expect(durableExecutionArn).toBeString();
			expect(durableExecutionArn).not.toBeEmpty();
			expect(appendKeyCalls).toContainEqual([{ durableExecutionArn }]);
		}
		expect(appendKeyCalls).toHaveLength(invocationCount);
		expect(removeKeyCalls).toHaveLength(invocationCount);
		expect(removeKeyCalls).toContainEqual([["durableExecutionArn"]]);

		const startLogs = loggerCalls.filter(
			([message]) => message === "Durable execution started",
		);
		const successLogs = loggerCalls.filter(
			([message]) => message === "Durable execution succeeded",
		);
		// The SDK uses multiple invocations for each execution, but mode-aware context
		// logging emits each wrapper lifecycle record only once per execution.
		expect(startLogs).toHaveLength(2);
		expect(successLogs).toHaveLength(2);
		expect(startLogs.length).toBeLessThan(invocationCount);
		expect(JSON.stringify(loggerCalls)).not.toContain(nestedSecret);
	});

	test("publishes metrics and preserves the original durable failure", async () => {
		const failureMessage = "original-durable-sentinel";
		const secret = "NEVER_LOG_FAILED_DURABLE_INPUT_20ee";
		const publishStoredMetrics = mock(function (this: Metrics) {
			return this;
		});
		const firstLogIndex = loggerCalls.length;

		const handler = useDurableHandler<{ nested: { secret: string } }, never>(
			"durable-failure-test",
			async (_event, _context, { metrics }) => {
				metrics.publishStoredMetrics = publishStoredMetrics;
				throw new Error(failureMessage);
			},
		);
		const runner = new LocalDurableTestRunner<never>({
			handlerFunction: handler,
		});
		const execution = await runner.run({
			payload: { nested: { secret } },
		});

		expect(execution.getStatus()).toBe("FAILED");
		expect(execution.getError().errorMessage).toBe(failureMessage);
		expect(execution.getError().errorType).toBe("Error");
		expect(publishStoredMetrics).toHaveBeenCalledTimes(
			execution.getInvocations().length,
		);

		const failureLogs = loggerCalls
			.slice(firstLogIndex)
			.filter(([message]) => message === "Durable execution failed");
		expect(failureLogs).toHaveLength(1);
		expect(JSON.stringify(failureLogs)).toContain("durable-failure-test");
		expect(JSON.stringify(failureLogs)).toContain("durableExecutionArn");
		expect(JSON.stringify(loggerCalls.slice(firstLogIndex))).not.toContain(
			secret,
		);
	});
});
