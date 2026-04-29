# Using AI Coding Agents with pawl

This guide explains how to use AI coding agents effectively in this repository. The instructions are tool-agnostic — they work with any AI coding assistant.

## Supported Tools & Configuration

pawl provides configuration files that major AI coding tools read automatically:

| File | Read by |
|------|---------|
| `AGENTS.md` | Codex CLI, Cursor, Windsurf, Amp, Devin, GitHub Copilot, Kiro |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.github/instructions/*.instructions.md` | GitHub Copilot (scoped by file path) |
| `packages/cdk/AGENTS.md` | All tools (when working in that directory) |
| `packages/lambda/AGENTS.md` | All tools (when working in that directory) |

For Claude Code, create a `CLAUDE.md` at the root with:
```
Follow the rules in ./AGENTS.md
```

For Gemini CLI, create a `GEMINI.md` at the root with the same content.

## Common Workflows

### Adding a New CDK Construct

Prompt pattern:
```
Create a new CDK construct for [AWS service] in packages/cdk/src/.
It should extend BasicConstruct, validate props with Zod, include IAM
permissions, and pass cdk-nag checks. Add a test in packages/cdk/tests/.
```

What the agent should do:
1. Read `packages/cdk/src/basic-construct.ts` to understand the base class
2. Look at an existing construct (e.g., `sqs.ts`) for the pattern
3. Create the construct file with Zod props schema
4. Create a test file with cdk-nag assertions
5. Export from `packages/cdk/index.ts`
6. Run `bun test`

### Adding a New Lambda Handler

Prompt pattern:
```
Create a new Lambda handler for [event source] in packages/lambda/src/.
Use the handlerFactory pattern with Powertools. Add a test with a fixture event.
```

What the agent should do:
1. Read `packages/lambda/src/base/handler-factory.ts` for the factory pattern
2. Look at an existing handler (e.g., `sqs-handler.ts`) for reference
3. Create the handler file
4. Create a fixture JSON event in `tests/`
5. Create a test file
6. Export from `packages/lambda/index.ts`
7. Run `bun test`

### Running a Well-Architected Review

Using the pawl CLI:
```bash
cd packages/cli
bun run index.ts
# Select your AWS profile and model
# Use the @well-architected prompt
```

Or ask any AI agent directly:
```
Review the CDK code in example/some-service/ against the AWS Well-Architected
Framework. Check all six pillars: Operational Excellence, Security, Reliability,
Performance Efficiency, Cost Optimization, and Sustainability.
```

### Cost Optimization

```
Analyze the CDK constructs in example/some-service/stacks/ for cost optimization
opportunities. Consider right-sizing, reserved capacity, storage tiers, and
serverless vs provisioned trade-offs.
```

### Writing Tests

```
Add tests for [construct/handler] in packages/[cdk|lambda]/tests/.
Use Bun test runner. For CDK, include cdk-nag assertions.
For Lambda, use fixture JSON events.
```

### Debugging CDK Synth Failures

```
Run `npx cdk synth` in example/some-service/ and help me fix any errors.
Check for missing context values, circular dependencies, or invalid props.
```

## Tips for Effective Agent Use

1. **Be specific about the package** — Always mention whether you're working in `packages/cdk/`, `packages/lambda/`, or `packages/cli/`
2. **Reference existing patterns** — Tell the agent to look at similar existing code before creating new code
3. **Ask for verification** — End prompts with "run `bun test` to verify"
4. **Use the boundaries** — If the agent tries to modify `cdk.out/` or auto-generated docs, remind it those are generated
5. **Iterate on compliance** — CDK constructs often need multiple passes to satisfy cdk-nag; this is normal

## Customizing Agent Behavior

### Adding project-wide rules

Edit `AGENTS.md` at the repository root. Keep it under 300 lines.

### Adding package-specific rules

Edit or create `AGENTS.md` in the relevant package directory (e.g., `packages/cdk/AGENTS.md`).

### Personal overrides (not committed)

Create `AGENTS.override.md` at the root (it's gitignored). Use this for personal preferences that shouldn't affect the team.

### Tool-specific configuration

- **Cursor:** Add `.cursor/rules/*.mdc` files with glob-scoped frontmatter
- **Copilot:** Add `.github/instructions/*.instructions.md` files
- **Windsurf:** Add `.windsurf/rules/*.md` files
- **Kiro:** Configure in `.kiro/settings/`
