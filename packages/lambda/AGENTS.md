# @pawl/lambda — AI Agent Instructions

This package provides typed AWS Lambda handler wrappers with built-in Powertools integration.

## Rules

- All handlers use the `handlerFactory` pattern from `./src/base/handler-factory.ts`
- Handlers MUST be type-safe — no `any`
- Use Zod for runtime event validation where applicable
- AWS Lambda Powertools (Logger, Tracer, Metrics) are always included
- Handler functions must be `export`-ed
- First parameter is always `serviceName` (CloudWatch identification)

## Adding a New Handler

1. Create `src/{event-source}-handler.ts`
2. Use `handlerFactory<EventType>(serviceName, handleRequest)` pattern
3. Add test in `tests/{event-source}-handler.test.ts` with fixture JSON
4. Add fixture event in `tests/{event-source}-event.json`
5. Export from `index.ts`
6. Run `bun test` to verify

## Commands

- Test: `bun test`
- Build: `bun run build`

## Boundaries

- Do NOT add CDK dependencies — this package is runtime-only
- Do NOT use raw `@types/aws-lambda` in consumer code — wrap it
