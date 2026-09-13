# pawl CLI

An AI-powered infrastructure agent that generates, reviews, and optimizes AWS infrastructure.

## Architecture

pawl CLI is built in two layers:

1. **`PawlHarness`** — Runtime-agnostic core that handles codebase scanning and prompt construction (`src/harness.ts`). Use this to integrate pawl with any agent framework.
2. **eve agent** — The `agent/` directory is an [eve](https://eve.dev) app: always-on instructions, typed tools, skills, declared subagents, and the HTTP channel.

`index.ts` is the launcher. It resolves an AWS profile, validates credentials (auto-login via SSO if needed), lets you choose a Bedrock model from the live catalog, then hands the terminal over to `eve dev`.

The launcher starts eve from the pawl package root, because eve locates its application by walking up for `agent/`. The directory you ran pawl from travels in `PAWL_PROJECT_DIR`, and every tool resolves the project through `src/project-dir.ts` — so the agent operates on *your* project, not on the CLI package.

### Where things run

Authored eve tools run in the app runtime, not in eve's sandbox, so they can drive `PawlHarness` against your real project directory. The sandbox stays on its default backend and backs eve's built-in `bash`, `read_file`, and `write_file` tools only.

## Usage

### Interactive terminal (eve TUI)

```bash
bun run index.ts
```

The CLI will:

1. Prompt you to select an AWS profile
2. Validate credentials (auto-login via SSO if needed)
3. Ask for the AWS region and load the Bedrock model catalog
4. Let you choose a provider → model → inference-profile scope
5. Hand the terminal over to `eve dev`

Once in the eve TUI, ask for what you want in plain language — the agent calls the tools above. `eve dev` also serves `/help`, `/model`, `/reset`, `/compact`, and the rest of the built-in commands.

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

#### Generated fluent pipeline

The generated stack imports the named CodeCommit repository with
`create: false`, then adds an editable `Approval` stage containing a manual
`Approve` action. This makes the initial pipeline complete without guessing a
build or deployment target. Add sequential work as separate stage objects:

```typescript
new CodePipeline(this, "Pipeline")
  .source({
    origin: "codecommit",
    create: false,
    repositoryName: "my-repo",
  })
  .stage({
    name: "Checks",
    // Actions in one stage run in parallel.
    actions: [unitAction, integrationAction],
  })
  .stage([
    { name: "Deploy", actions: [deployAction] },
    { name: "Approval", actions: [{ type: "approval", name: "Approve" }] },
  ]);
```

A single object passed to `.stage()` adds one stage. An outer stage list adds
stages sequentially in list order. All actions inside one stage object share a
run order and execute in parallel.

Pawl automatically selects an input when the current artifact frontier has one
artifact. CodeBuild outputs default to `<ActionName>Output`. If parallel actions
produce multiple artifacts, downstream consumers must name `input`/`inputs`
explicitly; omission raises `PipelineDefinitionError` with code
`ARTIFACT_INPUT_AMBIGUOUS`.

The library also supports two source ownership modes that the generator does
not emit: `create: true` creates a repository and can seed it once with `sync`,
and `repository` reuses a supplied `IRepository` construct. Create, import, and
supplied-repository fields are mutually exclusive.

`onPullRequest` and `autoReviewer` are independent options:

| `onPullRequest` | `autoReviewer` | Result |
|---|---|---|
| omitted/false | omitted | Native default-branch pipeline trigger |
| true | omitted | Exact-revision PR pipeline runs, without AI review |
| omitted/false | enabled | Native pipeline trigger plus standalone AI reviewer |
| true | enabled | PR pipeline runs with the durable `AIReview` bridge |

`--team` and `--stage` are written to the generated `cdk.json` context. Pawl's
`BasicConstruct` reads that context for naming, tags, and reviewer identity;
they are intentionally not `CodePipeline` constructor properties.

### eve HTTP API

```bash
eve dev --no-ui
curl -X POST http://localhost:2000/eve/v1/session \
  -H "Content-Type: application/json" \
  -d '{"message": "Plan infrastructure for this project"}'
```

The built-in eve session route replaces the old `/agents/*` endpoints:

| Route | Purpose |
|-------|---------|
| `POST /eve/v1/session` | Create a session and send the first message |
| `POST /eve/v1/session/:id` | Send a follow-up message |
| `GET /eve/v1/session/:id/stream` | Attach to the reconnectable event stream |

Pass a JSON schema with a message to get structured output, or use `eve invoke --json-schema` from the CLI.

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
- **Node.js 24+** (required by eve; `packages/cli` declares `engines.node: 24.x`)
- Bun for development in this repo

## Built-in Tools

The agent calls these tools itself — they are typed capabilities, not slash commands:

| Tool | Description |
|------|-------------|
| `plan` | Analyze codebase, generate infrastructure plan |
| `generate` | Generate CDK code from approved plan (**requires human approval**) |
| `well_architected` | AWS Well-Architected Framework review |
| `cost` | Cost optimization analysis |
| `architecture` | Render the plan's Mermaid diagram as ASCII |
| `init_project` | Scaffold a new pawl project (non-interactive) |

The root agent delegates the heavy lifting to declared subagents: `planner`, `generator`, and `well-architected`.

## Built-in Prompts

Located in `prompts/`:

- `infra.md` — Generate AWS CDK infrastructure
- `well-architected.md` — Full Well-Architected review
- `cost.md` — Cost optimization

## Skills

Located in `agent/skills/`:

- `pawl-constructs` — Reference for `@pawl/cdk` and `@pawl/lambda` APIs
- `pawl-plan` — Infrastructure plan generation workflow
- `pawl-codegen` — Infrastructure code generation workflow

## Development

```bash
bun test            # unit tests
bunx eve info       # discovery + diagnostics
bunx eve dev        # terminal UI (PAWL_PROJECT_DIR defaults to cwd)
bunx eve build      # compile .eve/ and build the host output
```

`bunx tsc --noEmit` currently reports 50 pre-existing type errors in `src/scaffold/prompts.ts`, `src/codecommit-init/`, `@pawl/cdk`, and a few tests. They predate the eve migration (the same config reported 77 before it) and none are in `agent/`, `src/launch.ts`, `src/project-dir.ts`, or `src/host-exec.ts`.
