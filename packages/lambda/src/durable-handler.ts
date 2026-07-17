import {
	type DurableContext,
	type DurableLambdaHandler,
	withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

export type DurableRequestHandler<TEvent, TResult> = (
	event: TEvent,
	context: DurableContext,
	utilities: { logger: Logger; tracer: Tracer; metrics: Metrics },
) => Promise<TResult>;

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

			context.configureLogger({ customLogger: logger, modeAware: true });
			logger.appendKeys({ durableExecutionArn });

			try {
				context.logger.info("Durable execution started", lifecycle);
				const result = await handleRequest(event, context, {
					logger,
					tracer,
					metrics,
				});
				context.logger.info("Durable execution succeeded", lifecycle);
				return result;
			} catch (error) {
				context.logger.error("Durable execution failed", lifecycle);
				throw error;
			}
		},
	);

	return async (event, context) => {
		try {
			return await durableHandler(event, context);
		} finally {
			try {
				metrics.publishStoredMetrics();
			} finally {
				logger.removeKeys(["durableExecutionArn"]);
			}
		}
	};
}
