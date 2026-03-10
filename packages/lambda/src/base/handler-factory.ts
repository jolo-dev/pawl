import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { createHookManager } from "./hooks";

export function handlerFactory<AwsEventType, AwsResultType = void>(
	serviceName: string,
	handleRequest: (
		event: AwsEventType,
		logger: Logger,
	) => Promise<AwsResultType>,
	options?: {
		defaultErrorHandler?: (error: Error) => Promise<AwsResultType>;
	},
) {
	const logger = new Logger({ serviceName });
	const tracer = new Tracer({ serviceName });
	tracer.provider.setLogger(logger);
	const hookManager = createHookManager<AwsEventType, AwsResultType>();

	// Add default logging hooks
	hookManager.addBeforeHook(async (event) => {
		logger.info("Processing request", { event });
		return event;
	});

	const handler = async (event: AwsEventType): Promise<AwsResultType> => {
		const { beforeHooks, afterHooks, errorHooks } = hookManager.getHooks();

		try {
			// Run before hooks
			let processedEvent = event;
			for (const hook of beforeHooks) {
				processedEvent = await hook(processedEvent);
			}

			// Run main handler
			let response = await handleRequest(processedEvent, logger);

			// Run after hooks
			for (const hook of afterHooks) {
				response = await hook(response);
			}

			return response;
		} catch (error) {
			// Run error hooks
			for (const hook of errorHooks) {
				try {
					return await hook(error as Error);
				} catch {}
			}

			// Handle default error case
			if (options?.defaultErrorHandler) {
				return options.defaultErrorHandler(error as Error);
			}
			throw error;
		}
	};

	return Object.assign(handler, {
		addBeforeHook: hookManager.addBeforeHook,
		addAfterHook: hookManager.addAfterHook,
		addErrorHook: hookManager.addErrorHook,
	});
}
