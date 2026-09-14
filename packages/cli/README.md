# pawl CLI

An AI-powered infrastructure agent that generates, reviews, and optimizes AWS infrastructure.

## Architecture

pawl CLI is built in three layers:

1. **`PawlHarness`** — Runtime-agnostic core that handles codebase scanning and prompt construction (`src/harness.ts`). Use this to integrate pawl with any agent framework.
2. **eve agent** — The `agent/` directory is an [eve](https://eve.dev) app: always-on instructions, typed tools, skills, declared subagents, and the HTTP channel.
3. **pawl client** — The terminal client (`src/tui/`) that owns the screen. It runs the AWS pre-flight in its own transcript, then attaches to the agent over eve's session API.

`index.ts` is the entrypoint. It resolves an AWS profile, validates credentials (opening a browser for SSO if needed), lets you choose a Bedrock model from the live catalog, starts the eve runtime **headless on loopback**, and attaches the client to it. `eve dev`'s own terminal UI is not used: it is not extensible (no command registration, no theme or pane hooks), so pawl renders its own. See `docs/adr/0001-custom-opentui-client.md`.

The runtime starts from the pawl package root, because eve locates its application by walking up for `agent/`. The directory you ran pawl from travels in `PAWL_PROJECT_DIR`, and every tool resolves the project through `src/project-dir.ts` — so the agent operates on *your* project, not on the CLI package.

### Where things run

Authored eve tools run in the app runtime, not in eve's sandbox, so they can drive `PawlHarness` against your real project directory. The sandbox stays on its default backend and backs eve's built-in `bash`, `read_file`, and `write_file` tools only.

### Two runtime constraints that are easy to trip over

- **eve's server must run under Node, not Bun.** Launched with Bun it binds and answers on some routes, then fails its worker init (`[crossws] Using Node.js adapter in an incompatible environment`). The launcher resolves a real `node` from `PATH` for the runtime; pawl itself still runs under Bun.
- **Readiness means the health route answers, not merely that something is listening.** The half-started runtime above accepts a connection on `/eve/v1/session` while being unable to serve a turn.

## Usage

### Interactive terminal (pawl client)

```bash
bun run index.ts
```

The CLI will:

1. Prompt you to select an AWS profile
2. Validate credentials (opening a browser for SSO if needed, with the URL kept in the transcript)
3. Ask for the AWS region and load the Bedrock model catalog
4. Let you choose a provider → model → inference-profile scope
5. Start the runtime and open the conversation

Selections are numbered transcript lines rather than a separate widget, so the profile and model you chose stay in the scrollback alongside the conversation.

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
| `scan_resources` | Read the AWS account and compare it with this project's synthesized output (read-only) |
| `deploy_preview` | Show what `cdk deploy` would change (read-only) |
| `deploy_infra` | Deploy with `cdk deploy` (**requires human approval**) |
| `well_architected` | AWS Well-Architected Framework review, including the account by default |
| `cost` | Cost analysis from resource configuration — **no billing data** |
| `architecture` | Render the plan's Mermaid diagram as ASCII |
| `init_project` | Scaffold a new pawl project (non-interactive) |

The root agent delegates the heavy lifting to declared subagents: `planner`, `generator`, `well-architected`, and `infra-auditor`.

### Analysis is read-only; creation is approval-gated

`scan_resources`, `deploy_preview`, `well_architected`, `cost`, and `architecture` change nothing. Only `generate` and `deploy_infra` produce changes, and both require explicit approval.

Deploying is always two steps: `deploy_preview` produces the `cdk diff`, you agree to that change set, and only then does `deploy_infra` run. It is approval-gated rather than relying on `cdk`'s own prompt, because the tool has no terminal for `cdk` to prompt in.

## Analyzing an account

`scan_resources` reads the deployed resources of one account and region and compares them with the resources this project's CDK code synthesizes. It reports drift in both directions, plus the Pawl construct candidates for resources Pawl does not already manage.

**Coverage is part of the answer.** A scan reports which services it read and which it could not, and `pawl` never describes an account as clean when part of it was not read. Services it cannot read at all are named rather than omitted.

### Permissions

The scan is read-only. `iam/pawl-readonly-policy.json` is the exact grant it needs — 13 read actions across 7 services — and it is **generated from the scanner sources**, so it cannot drift from what the code calls. Run the scanners' tests after adding a scanner and the policy will be shown as out of date.

Drift for CloudFormation-managed resources is mostly not pawl's to compute: `cdk diff` already compares the deployed stack with the local synthesis, and `DetectStackDrift` covers template against actual. Pawl's own matching only covers resources outside CloudFormation, using the physical names and tags its constructs pin.

### What a scan cannot tell you

- Nothing about cost. Pawl does not call the Cost Explorer API, so every figure is derived from resource configuration, never measured spend.
- Nothing about traffic. A resource appears because it exists, not because it is used.
- Nothing about history. A scan is a point-in-time read.

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
bunx eve dev        # eve's own terminal UI, for working on the agent itself
bunx eve build      # compile .eve/ and build the host output
```

### Live verification

`scripts/verify-live-session.ts` drives the session client against a real eve
server and a real model turn, then asserts on the state the reducer produced. It
exists because every event shape the client handles comes from eve's type
definitions, and a mismatch there degrades to "ignored event" — it fails
silently by design. It costs real model calls, so run it when the reducer, the
session driver, or eve itself changes.

```bash
AWS_PROFILE=<profile> AWS_REGION=<region> bunx eve dev --no-ui --port 2145 &
bun scripts/verify-live-session.ts http://127.0.0.1:2145
```

It exits non-zero on failure. It has caught two bugs that a green unit suite
could not, both times because the tests encoded the same wrong assumption as the
code: breaking event consumption on `turn.completed` (which is not a boundary,
so the *next* turn was never read), and launching eve with Bun instead of Node.

### Model configuration

The agent runs on AWS Bedrock through a direct AI SDK provider (`agent/lib/bedrock.ts`), not the Vercel AI Gateway. The pre-flight sets these before starting the runtime:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AWS_PROFILE` | — | Profile resolved by the pre-flight; the provider reads it via the AWS credential chain (profiles, SSO cache, web identity, ECS, IMDS) |
| `AWS_REGION` | `us-east-1` | Region for the Bedrock endpoint |
| `PAWL_BEDROCK_MODEL` | `eu.amazon.nova-2-lite-v1:0` | Inference-profile id |
| `PAWL_CONTEXT_WINDOW_TOKENS` | per-model, from a curated catalog (Nova 2 Lite 128k) | Override for models pawl does not know |

Set `PAWL_BEDROCK_MODEL` (and `PAWL_CONTEXT_WINDOW_TOKENS` if the model is unknown to pawl) to run a different model without the launcher. Note that `eve`'s `/model` command cannot edit a provider-authored model — change it here or via the launcher.

`bunx tsc --noEmit` currently reports 50 pre-existing type errors in `src/scaffold/prompts.ts`, `src/codecommit-init/`, `@pawl/cdk`, and a few tests. They predate the eve migration (the same config reported 77 before it) and none are in `agent/`, `src/launch.ts`, `src/project-dir.ts`, or `src/host-exec.ts`.
