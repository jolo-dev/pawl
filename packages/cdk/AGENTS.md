# @pawl/cdk — AI Agent Instructions

This package contains AWS CDK constructs that enforce best practices and compliance.

## Rules

- Every construct MUST extend `BasicConstruct` from `./src/basic-construct.ts`
- Use Zod schemas for props validation
- Include cdk-nag compliance checks in all tests
- Constructs must be self-contained (IAM, alarms, tags included)
- Export new constructs from `index.ts`
- No direct `aws-cdk-lib` usage in consumer code — this package wraps it

## Adding a New Construct

1. Create `src/{construct-name}.ts` extending `BasicConstruct`
2. Define a Zod schema for props
3. Add test in `tests/{construct-name}.test.ts` with cdk-nag assertions
4. Export from `index.ts`
5. Run `bun test` to verify

## Commands

- Test: `bun test`
- Build: `bun run build`
- CDK synth (test stack): `bun run test:cdk:synth`

## Boundaries

- Do NOT modify `volume/` — Docker-mounted test data
- Do NOT import from `aws-cdk-lib` in tests without going through construct wrappers
- Do NOT skip cdk-nag in test assertions
