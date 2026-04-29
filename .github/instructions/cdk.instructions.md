---
applyTo: "packages/cdk/**/*.ts"
---
This is the @pawl/cdk package — an AWS CDK construct library.

Rules:
- Every construct extends BasicConstruct from src/basic-construct.ts
- Use Zod schemas for props validation
- Include cdk-nag compliance checks in tests
- Constructs must be self-contained (IAM, alarms, tags)
- Export new constructs from index.ts
- Test with: `bun test`
