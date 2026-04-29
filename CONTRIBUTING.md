# Contributing to pawl

Thank you for your interest in contributing! This guide will help you get set up and understand how we work.

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Docker](https://www.docker.com/) (for Localstack integration tests)
- Node.js 22+
- Git

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/pawl.git
cd pawl
bun install
```

Verify everything works:

```bash
bunx biome check .   # Lint/format check
bun run build        # Build all packages
bun test             # Run tests (Docker required for integration tests)
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run verification: `bunx biome check . && bun test`
4. Submit a pull request

## Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting. Configuration is in `biome.json`.

- **Indentation:** Tabs
- **Quotes:** Double quotes
- **Imports:** Auto-organized by Biome

Run `bunx biome check . --write` to auto-fix formatting issues.

## TypeScript Rules

- Strict mode enabled — no implicit `any`
- Use `unknown` with type narrowing instead of `any`
- Use Zod for runtime validation
- Named exports only — never `export default`
- Prefer `const` over `let`; never use `var`

## Adding a CDK Construct

1. Create `packages/cdk/src/{construct-name}.ts`
2. Extend `BasicConstruct` from `./src/basic-construct.ts`
3. Define props using a Zod schema
4. Include IAM permissions, alarms, and tags within the construct
5. Add a test in `packages/cdk/tests/{construct-name}.test.ts`
   - Include cdk-nag assertions
6. Export from `packages/cdk/index.ts`
7. Run `bun test` in `packages/cdk/`

## Adding a Lambda Handler

1. Create `packages/lambda/src/{event-source}-handler.ts`
2. Use the `handlerFactory` pattern (see existing handlers for reference)
3. Add a fixture event in `packages/lambda/tests/{event-source}-event.json`
4. Add a test in `packages/lambda/tests/{event-source}-handler.test.ts`
5. Export from `packages/lambda/index.ts`
6. Run `bun test` in `packages/lambda/`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Write a clear description of what changed and why
- Ensure CI passes (lint + tests)
- Add tests for new functionality
- Update documentation if you changed public API

## Commit Messages

Use clear, descriptive commit messages:

```
feat(cdk): add S3 bucket construct with encryption
fix(lambda): handle empty SQS batch gracefully
docs: update contributing guide
```

## Project Structure

```
packages/
├── cdk/       # CDK constructs — extend BasicConstruct
├── lambda/    # Lambda handlers — use handlerFactory
└── cli/       # AI infrastructure CLI
example/
├── some-service/  # Full working example
└── tutorial/      # Getting started tutorial
docs/              # Astro Starlight documentation site
```

## Questions?

Open an issue or start a discussion. We're happy to help!
