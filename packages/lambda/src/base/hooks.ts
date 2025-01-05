type Hook<T> = (input: T) => Promise<T> | T;
type ErrorHook<Response> = (error: Error) => Promise<Response> | Response;

export type HandlerWithHooks<
  AwsLambdaHandlerType,
  AwsEventType,
  AwsResultType = void,
> = AwsLambdaHandlerType & {
  addBeforeHook: (hook: Hook<AwsEventType>) => void;
  addAfterHook: (hook: Hook<AwsResultType>) => void;
  addErrorHook: (hook: ErrorHook<AwsResultType>) => void;
};

// Hook manager to compose middleware
export function createHookManager<AwsEventType, AwsResultType = void>() {
  const beforeHooks: Hook<AwsEventType>[] = [];
  const afterHooks: Hook<AwsResultType>[] = [];
  const errorHooks: ErrorHook<AwsResultType>[] = [];

  return {
    addBeforeHook: (hook: Hook<AwsEventType>) => beforeHooks.push(hook),
    addAfterHook: (hook: Hook<AwsResultType>) => afterHooks.push(hook),
    addErrorHook: (hook: ErrorHook<AwsResultType>) => errorHooks.push(hook),
    getHooks: () => ({ beforeHooks, afterHooks, errorHooks }),
  };
}
