---
applyTo: "packages/lambda/**/*.ts"
---
This is the @pawl/lambda package — typed AWS Lambda handler wrappers.

Rules:
- Use the handlerFactory pattern from src/base/handler-factory.ts
- Handlers must be type-safe, no `any`
- AWS Lambda Powertools (Logger, Tracer, Metrics) are always included
- Handler functions must be exported
- First parameter is always serviceName
- Export new handlers from index.ts
- Test with: `bun test`
