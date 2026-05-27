# pawl CLI

An AI-powered infrastructure agent that generates, reviews, and optimizes AWS infrastructure.

## Architecture

pawl CLI is built in two layers:

1. **`PawlHarness`** — Runtime-agnostic core that handles codebase scanning and prompt construction. Use this to integrate pawl with any agent framework.
2. **Pi TUI** — Interactive terminal interface powered by `pi-coding-agent`.
3. **Flue Agents** — HTTP-accessible agents powered by `@flue/runtime`.

## Usage

### Pi TUI (interactive terminal)

```bash
bun run index.ts
```

The CLI will:

1. Prompt you to select an AWS profile
2. Validate credentials (auto-login via SSO if needed)
3. Let you choose a Bedrock model (provider → model → scope → region)
4. Start an interactive agent session

### `pawl init`

Create a new pawl project from a clean directory:

```bash
pawl init
pawl init --name my-app --package-manager bun --aws-profile dev --test-mode localstack
```

You will be prompted for anything you do not pass as a flag:
- **Project name** (required, no default)
- **Package manager** — Bun (recommended), pnpm, or npm (not recommended)
- **AWS profile** — saved into `cdk.json` and package scripts
- **Test mode** — LocalStack or none
- **Install dependencies now** — installs with your chosen package manager if you say yes

Flags override prompts when provided.
If you choose Bun, the scaffold omits `tsx` from `package.json`.
If you choose LocalStack, the scaffold includes local dev helpers and example integration test scaffolding. `pawl init` refuses to run in a non-empty directory.

### Flue Agents (HTTP API)

```bash
npx flue dev --target node --env .env
curl http://localhost:3583/agents/plan/test-1 \
  -H "Content-Type: application/json" \
  -d '{"notes": "Use RDS, not DynamoDB"}'
```

### Harness (programmatic)

```typescript
import { PawlHarness } from "@pawl/cli/src/harness";

const harness = new PawlHarness({ cwd: "/path/to/project" });
const planPrompt = await harness.commands.plan("Use serverless architecture");
// Send planPrompt to your LLM of choice...
```

## Prerequisites

- AWS account with Bedrock access
- AWS SSO configured (`aws configure sso`)
- Bun runtime

## Built-in Commands

| Command | Description |
|---------|-------------|
| `/plan` | Analyze codebase, generate infrastructure plan |
| `/generate` | Generate CDK code from approved plan |
| `/well-architected` | AWS Well-Architected Framework review |
| `/cost` | Cost optimization analysis |
| `/deploy` | Deploy with CDK (TODO) |
| `/init` | Initialize new pawl project |
| `/simulate` | Simulate infrastructure changes (TODO) |

## Built-in Prompts

Located in `prompts/`:

- `infra.md` — Generate AWS CDK infrastructure
- `well-architected.md` — Full Well-Architected review
- `cost.md` — Cost optimization

## Skills

Located in `skills/`:

- `pawl-constructs` — Reference for `@pawl/cdk` and `@pawl/lambda` APIs
- `pawl-plan` — Infrastructure plan generation workflow
- `pawl-codegen` — Infrastructure code generation workflow
