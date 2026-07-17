import {
	type DurableContext,
	type DurableLambdaHandler,
	withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

/**
 * Handles a durable request with shared Powertools utilities.
 *
 * @remarks
 * Treat the supplied `Metrics` utility as physical-invocation scoped. Durable
 * replay and resumption can invoke this callback multiple times, and stored
 * metrics are published at the end of every physical invocation. Callers that
 * need a metric emitted once per logical execution must place that emission
 * behind a durable or otherwise idempotent boundary.
 */
export type DurableRequestHandler<TEvent, TResult> = (
	event: TEvent,
	context: DurableContext,
	utilities: { logger: Logger; tracer: Tracer; metrics: Metrics },
) => Promise<TResult>;

type ObservabilityStage =
	| "configureLogger"
	| "appendCorrelation"
	| "logStarted"
	| "logSucceeded"
	| "logFailed"
	| "publishStoredMetrics"
	| "removeCorrelation";

const reportObservabilityFailure = (
	stage: ObservabilityStage,
	error: unknown,
): void => {
	try {
		const errorType = error instanceof Error ? "Error" : typeof error;
		console.error("Durable handler observability failure", stage, errorType);
	} catch {
		// The fallback must never alter the durable execution outcome.
	}
};

const runObservabilityOperation = (
	stage: ObservabilityStage,
	operation: () => void,
): void => {
	try {
		operation();
	} catch (error) {
		reportObservabilityFailure(stage, error);
	}
};

export function useDurableHandler<TEvent, TResult>(
	serviceName: string,
	handleRequest: DurableRequestHandler<TEvent, TResult>,
): DurableLambdaHandler {
	const logger = new Logger({ serviceName });
	const tracer = new Tracer({ serviceName });
	const metrics = new Metrics({ namespace: serviceName, serviceName });
	tracer.provider.setLogger(logger);

	const durableHandler = withDurableExecution<TEvent, TResult>(
		async (event, context) => {
			const durableExecutionArn = context.executionContext.durableExecutionArn;
			const lifecycle = { serviceName, durableExecutionArn };

			runObservabilityOperation("configureLogger", () => {
				context.configureLogger({ customLogger: logger, modeAware: true });
			});
			runObservabilityOperation("appendCorrelation", () => {
				logger.appendKeys({ durableExecutionArn });
			});
			runObservabilityOperation("logStarted", () => {
				context.logger.info("Durable execution started", lifecycle);
			});

			try {
				const result = await handleRequest(event, context, {
					logger,
					tracer,
					metrics,
				});
				runObservabilityOperation("logSucceeded", () => {
					context.logger.info("Durable execution succeeded", lifecycle);
				});
				return result;
			} catch (error) {
				runObservabilityOperation("logFailed", () => {
					context.logger.error("Durable execution failed", lifecycle);
				});
				throw error;
			}
		},
	);

	return async (event, context) => {
		try {
			return await durableHandler(event, context);
		} finally {
			runObservabilityOperation("publishStoredMetrics", () => {
				metrics.publishStoredMetrics();
			});
			runObservabilityOperation("removeCorrelation", () => {
				logger.removeKeys(["durableExecutionArn"]);
			});
		}
	};
}
