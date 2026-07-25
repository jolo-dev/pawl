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

### `pawl init codecommit`

Create a Pawl CDK project that creates and initially seeds a CodeCommit repository:

```bash
pawl init codecommit --sync . --directory infra --no-autoreviewer --team platform --no-install --no-deploy
pawl init codecommit --name my-repo --no-sync --autoreviewer --model eu.anthropic.claude-sonnet-4-6 --team platform --install --deploy --aws-profile dev --region eu-central-1
```

**Interactive (TTY):** You will be prompted for repository name, sync mode, directory, branch (default `main`), team, stage (default `dev`), auto-review, model (when auto-review is enabled), confirmation, install, deploy, and AWS profile/region (when deploying).

**Non-interactive (non-TTY):** All choices must be supplied as flags. Required: `--name`, exactly one of `--sync`/`--no-sync`, `--team`, exactly one of `--autoreviewer`/`--no-autoreviewer`, exactly one of `--install`/`--no-install`, exactly one of `--deploy`/`--no-deploy`. `--model` is required with `--autoreviewer`. Deployment requires `--install`, `--aws-profile`, and `--region`.

| Flag | Behavior |
|------|----------|
| `--name <name>` | CodeCommit repository name |
| `--sync <path>` | Seed from an existing source path (use `.` for cwd) |
| `--no-sync` | Create a new project without existing source |
| `--directory <name>` | Infrastructure directory (sync: default `infra`) or output path (no-sync: default `./<name>`) |
| `--branch <name>` | Initial branch (default: `main`) |
| `--autoreviewer` | Enable the durable Anthropic auto-reviewer |
| `--no-autoreviewer` | Disable the auto-reviewer |
| `--model <model-id>` | Anthropic Bedrock model ID for auto-review |
| `--team <name>` | Owning team tag |
| `--stage <dev\|qa\|prod>` | Deployment stage (default: `dev`) |
| `--install` | Install generated project dependencies |
| `--no-install` | Do not install dependencies |
| `--deploy` | Deploy after installation |
| `--no-deploy` | Do not deploy |
| `--aws-profile <profile>` | AWS profile used for deployment |
| `--region <region>` | AWS region used for deployment |
| `--help` | Show help without prompting or writing files |

**Warning:** Source files are uploaded only as the repository's initial seed. Later local edits are not automatically synchronized to CodeCommit.

### `pawl init codepipeline`

Create a Pawl CDK project with a CodePipeline CI/CD pipeline for an existing CodeCommit repository:

```bash
pawl init codepipeline --source codecommit --source-name my-repo --no-autoreviewer --team platform --no-install --no-deploy
pawl init codepipeline --source codecommit --source-name my-repo --on-pr --autoreviewer --model eu.anthropic.claude-sonnet-4-6 --team platform --install --deploy --aws-profile dev --region eu-central-1
```

| Flag | Behavior |
|------|----------|
| `--source <type>` | Source type: `codecommit` (required) |
| `--source-name <name>` | CodeCommit repository name (import existing) |
| `--source-branch <name>` | Source branch (default: `main`) |
| `--pipeline-stage <spec>` | Repeatable. Pipeline stage action |
| `--on-pr` / `--on-pull-request` | PR-gated mode: trigger on PR events only |
| `--autoreviewer` / `--no-autoreviewer` | Enable/disable auto-review |
| `--model <model-id>` | Anthropic Bedrock model ID for auto-review |
| `--team <name>` | Owning team tag |
| `--stage <dev\|qa\|prod>` | Deployment stage (default: `dev`) |
| `--install` / `--no-install` | Install dependencies |
| `--deploy` / `--no-deploy` | Deploy after installation |
| `--aws-profile <profile>` | AWS profile used for deployment |
| `--region <region>` | AWS region used for deployment |
| `--help` | Show help |

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
