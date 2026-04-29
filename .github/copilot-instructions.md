Follow the conventions defined in the root AGENTS.md file.

This is a TypeScript monorepo using Bun, Biome, and Zod.

Key rules:
- Use named exports, never default exports
- No `any` types — use `unknown` with type narrowing or Zod
- Use tabs for indentation, double quotes for strings
- CDK constructs must extend BasicConstruct (packages/cdk/src/basic-construct.ts)
- Lambda handlers must use the handlerFactory pattern (packages/lambda/src/base/handler-factory.ts)
- Run `bunx biome check .` and `bun test` before suggesting changes are complete
