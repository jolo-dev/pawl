# CodeCommit Construct with Auto-Reviewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `CodeCommit` construct in `@pawl/cdk` that manages a CodeCommit repository's review lifecycle. When `autoReview` is active, the construct deploys the full durable auto-reviewer — durable reviewer Lambda, router Lambda, DynamoDB state table, CodeBuild project, Bedrock IAM, event routing, and all grants — alongside the event routing. Any Pawl app opts into automated PR review with one prop.

**Problem:** Today `CodeCommitReviewEvents` (Pawl) only routes events and grants comment/read IAM. The entire reviewer infrastructure is hand-wired in the app's `stacks/reviewer-stack.ts` (~150 lines), and the reviewer runtime code (handlers, workflow, adapters, services, domain, ports) lives in the app repo (`durable-lambda-reviewer/src/`). No other Pawl consumer can reuse the reviewer without copy-pasting all of that.

**Architecture:** Everything stays in `@pawl/cdk` — no new package. The reviewer runtime code (handlers, workflow, adapters, services, domain, ports, router) moves from the app into `packages/cdk/src/reviewer/`. `@pawl/cdk` gains the runtime SDK deps (`@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-codecommit`, `@aws-sdk/client-codebuild`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws/durable-execution-sdk-js`). A new `CodeCommit` construct wraps `CodeCommitReviewEvents` and, when `autoReview` is set, creates a `CodeCommitAutoReviewer` (an internal sub-construct) that wires all the reviewer infrastructure using the bundled handler entry points.

**Tech Stack:** Bun, TypeScript 6, AWS CDK, `@pawl/cdk`, `@pawl/lambda`, `@aws/durable-execution-sdk-js`, AWS SDK v3, DynamoDB, CodeBuild, EventBridge, CodeCommit, Amazon Bedrock Converse, Zod, cdk-nag, Bun test.

---

## Design decisions

### D1. Runtime code moves into `@pawl/cdk` (no new package)

The reviewer runtime (everything under `durable-lambda-reviewer/src/` except `stacks/`) moves into `packages/cdk/src/reviewer/`. `@pawl/cdk` gains the runtime SDK deps in its `package.json`. The two Lambda handler entry points live at `packages/cdk/src/reviewer/handlers/reviewer.ts` and `packages/cdk/src/reviewer/handlers/router.ts`, resolved by the construct via `path.resolve(__dirname, "reviewer/handlers/reviewer.ts")`.

**Rationale:** `NodejsFunction` needs a file-system `entry` path. Keeping the runtime inside `@pawl/cdk` makes the construct fully self-contained — a consumer declares `@pawl/cdk` and nothing else. esbuild bundles the handlers at synth time, resolving the SDK deps from the consumer's `node_modules` (where `@pawl/cdk`'s transitive deps are hoisted).

**Note on package weight:** `@pawl/cdk` currently has no runtime SDK deps. Adding them (`@aws-sdk/*`, `@aws/durable-execution-sdk-js`) increases install size, but these are only bundled into the two reviewer Lambdas — they don't affect non-reviewer consumers' bundles.

### D2. `CodeCommit` construct — the high-level entry point

A new `@pawl/cdk` construct that a consumer creates per repository:

```typescript
new CodeCommit(this, "Repo", {
  repositoryName: "my-repo",
  autoReview: {
    modelId: "eu.anthropic.claude-sonnet-4-6",
    // optional overrides:
    executionTimeoutSeconds: 2_592_000,
    retentionDays: 14,
    timeoutMinutes: 15,
    memorySize: 512,
    codeBuildComputeSize: "SMALL",
    codeBuildNetworkPolicy: {
      mode: "public-test",
      packageAccess: { mode: "approved-registry", endpoint: "https://registry.npmjs.org" },
    },
    botArnPatterns: "",
  },
});
```

When `autoReview` is set, `CodeCommit` internally creates:

- A `CodeCommitAutoReviewer` sub-construct (D3) — all reviewer infra
- A `CodeCommitReviewEvents` targeting the auto-reviewer's router

When `autoReview` is absent, `CodeCommit` behaves as a thin wrapper around `CodeCommitReviewEvents` (event routing only, consumer supplies a `router` Lambda — current behavior, backward-compatible).

`team` and `stage` are read from CDK context (as `BasicConstruct` already does for naming prefixes).

### D3. `CodeCommitAutoReviewer` — the infra bundler (internal)

An internal sub-construct (not the consumer-facing API, but exported for advanced multi-repo use) that creates and wires:

- `DynamoDbTable` (state table: PK `pk`, SK `sk`, TTL `expiresAt`, PITR on, retained)
- `CodeBuildProject` (per repository, configurable compute + network policy)
- `DurableLambdaFunction` (reviewer, entry = bundled `reviewer.ts`, configurable timeout/memory)
- `LambdaFunction` (router, entry = bundled `router.ts`)
- Bedrock `InvokeModel` IAM (inference-profile + foundation-model, cdk-nag suppressed)
- All grants: state table read/write (reviewer + router), CodeBuild run/read (reviewer), CodeCommit read/config/comment (reviewer), durable invoke/callback/read (router → reviewer)
- Per-repo `CodeCommitReviewEvents` (event routing to the shared router)

Props (Zod-validated):

```typescript
{
  repositories: string[] (min 1),
  reviewerModelId: string,
  reviewerAlias?: string (default "live"),
  reviewerExecutionTimeoutSeconds?: number (default 2_592_000),
  reviewerRetentionDays?: number (default 14),
  reviewerTimeoutMinutes?: number (default 15),
  reviewerMemorySize?: number (default 512),
  codeBuildComputeSize?: "SMALL" | "MEDIUM" | "LARGE" (default "SMALL"),
  codeBuildNetworkPolicy?: CodeBuildNetworkPolicy,
  botArnPatterns?: string (default ""),
}
```

The reviewer Lambda physical name is `${team}-${stage}-Reviewer-lambda` (derived from context) so the router invoke target, IAM scope, and bot-filter ARN stay aligned.

### D4. Relationship to existing `CodeCommitReviewEvents`

`CodeCommitReviewEvents` is unchanged (backward-compatible). `CodeCommit` is a new, higher-level construct that composes `CodeCommitReviewEvents` + optionally `CodeCommitAutoReviewer`. Existing consumers of `CodeCommitReviewEvents` keep working; new consumers use `CodeCommit`.

### D5. Multi-repo support

For a single repo, use `CodeCommit` (one construct, one repo). For multi-repo with a shared reviewer/router/state-table (the current app pattern), use `CodeCommitAutoReviewer` directly with `repositories: ["repo-a", "repo-b"]` and create `CodeCommitReviewEvents` per repo targeting the shared router. Both paths are supported.

### D6. App becomes a thin consumer

The app's `stacks/reviewer-stack.ts` collapses to:

```typescript
export class DurableLambdaReviewerStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    for (const repo of this.node.tryGetContext("repositories")) {
      new CodeCommit(this, `Repo-${repo}`, {
        repositoryName: repo,
        autoReview: {
          modelId: this.node.tryGetContext("reviewerModelId"),
          botArnPatterns: this.node.tryGetContext("botArnPatterns"),
        },
      });
    }
  }
}
```

The app's `src/` directory is deleted (all code moved to `@pawl/cdk/src/reviewer/`). The app retains `cdk.json`, `index.ts`, `stacks/`, `tests/` (integration + security tests stay app-local).

---

## File and responsibility map

### Pawl library (`/Users/jolo/Development/pawl`)

| File                                                        | Responsibility                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/cdk/src/reviewer/` (new dir)                      | Reviewer runtime: handlers, workflow, adapters, services, domain, ports, router |
| `packages/cdk/src/reviewer/handlers/reviewer.ts`            | Durable reviewer handler entry (moved from app `durable-reviewer-handler.ts`)   |
| `packages/cdk/src/reviewer/handlers/router.ts`              | Event router handler entry (moved from app `event-router-handler.ts`)           |
| `packages/cdk/src/reviewer/workflows/reviewer-workflow.ts`  | Durable event-loop workflow (moved from app)                                    |
| `packages/cdk/src/reviewer/adapters/*`                      | CodeCommit/Bedrock/CodeBuild/DynamoDB adapters (moved from app)                 |
| `packages/cdk/src/reviewer/services/*`                      | Review engine, reconciler, config loader, etc. (moved from app)                 |
| `packages/cdk/src/reviewer/domain/*`                        | Finding, review-event, review-request, policy, config domain (moved from app)   |
| `packages/cdk/src/reviewer/ports/*`                         | Provider-neutral ports (moved from app)                                         |
| `packages/cdk/src/reviewer/router/*`                        | Event router, normalizer, lambda-transport (moved from app)                     |
| `packages/cdk/src/codecommit.ts` (new)                      | `CodeCommit` construct — high-level, `autoReview` opt-in                        |
| `packages/cdk/src/codecommit-auto-reviewer.ts` (new)        | `CodeCommitAutoReviewer` construct — infra bundler                              |
| `packages/cdk/src/codecommit-review-events.ts` (unchanged)  | Existing event-routing construct (backward-compatible)                          |
| `packages/cdk/index.ts` (modified)                          | Export `CodeCommit`, `CodeCommitAutoReviewer`                                   |
| `packages/cdk/package.json` (modified)                      | Add runtime SDK deps                                                            |
| `packages/cdk/tests/reviewer/` (new)                        | Unit tests moved from app (workflow, adapters, services, domain)                |
| `packages/cdk/tests/codecommit.test.ts` (new)               | Construct tests for `CodeCommit` (autoReview on/off)                            |
| `packages/cdk/tests/codecommit-auto-reviewer.test.ts` (new) | Construct tests for the infra bundler                                           |

### Application (`/Users/jolo/Development/durable-lambda-reviewer`)

| File                                   | Responsibility                                              |
| -------------------------------------- | ----------------------------------------------------------- |
| `stacks/reviewer-stack.ts` (rewritten) | Thin consumer: `new CodeCommit(...)` per repo               |
| `src/` (deleted)                       | All code moved to `@pawl/cdk/src/reviewer/`                 |
| `tests/aws/` (stays)                   | Live AWS integration tests (app-local)                      |
| `tests/security/` (stays)              | Synth-based security assertions against the app stack       |
| `cdk.json` (unchanged)                 | Context: repositories, modelId, team, stage, botArnPatterns |

---

## Tasks

### Task 1: Move reviewer runtime into `@pawl/cdk/src/reviewer/`

- [ ] 1.1 Create `packages/cdk/src/reviewer/` with subdirs: `handlers/`, `workflows/`, `adapters/`, `services/`, `domain/`, `ports/`, `router/`.
- [ ] 1.2 Move from `durable-lambda-reviewer/src/` to `packages/cdk/src/reviewer/`, preserving structure:
  - `handlers/durable-reviewer-handler.ts` → `handlers/reviewer.ts`
  - `handlers/event-router-handler.ts` → `handlers/router.ts`
  - `workflows/`, `adapters/`, `services/`, `domain/`, `ports/`, `router/` → same names
- [ ] 1.3 Fix all import paths. `@pawl/lambda` imports resolve from `@pawl/cdk`'s deps. Relative imports stay relative.
- [ ] 1.4 Add runtime SDK deps to `packages/cdk/package.json`: `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-codebuild`, `@aws-sdk/client-codecommit`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws/durable-execution-sdk-js` (via catalog/workspace).
- [ ] 1.5 Move unit tests + fakes from `durable-lambda-reviewer/tests/unit/` and `tests/fakes/` to `packages/cdk/tests/reviewer/`, fixing import paths.
- [ ] 1.6 Run `bunx tsc --noEmit` + `bun test` in `packages/cdk/` — all moved tests pass.
- [ ] 1.7 `bun install` at Pawl root to update lockfile.

### Task 2: Create `CodeCommitAutoReviewer` construct

- [ ] 2.1 Create `packages/cdk/src/codecommit-auto-reviewer.ts` with Zod-validated config schema (props from D3).
- [ ] 2.2 Implement: state table, per-repo CodeBuild projects, reviewer durable Lambda (entry = `path.resolve(__dirname, "reviewer/handlers/reviewer.ts")`), router Lambda (entry = `path.resolve(__dirname, "reviewer/handlers/router.ts")`), Bedrock IAM (inference-profile + foundation-model + cdk-nag suppression), all grants.
- [ ] 2.3 Derive reviewer function name `${team}-${stage}-Reviewer-lambda` from context.
- [ ] 2.4 Wire per-repo `CodeCommitReviewEvents` inside the construct (event routing to shared router + grants).
- [ ] 2.5 Write construct tests (`packages/cdk/tests/codecommit-auto-reviewer.test.ts`): synth-based assertions for resources, IAM scoping, env vars, function naming, multi-repo. Port existing `tests/constructs/reviewer-stack.test.ts` assertions.
- [ ] 2.6 Run gates in `packages/cdk/`.

### Task 3: Create `CodeCommit` construct with `autoReview`

- [ ] 3.1 Create `packages/cdk/src/codecommit.ts` with `CodeCommit` construct.
- [ ] 3.2 Props: `repositoryName`, optional `router` (for non-auto-review mode), optional `autoReview` (object: `modelId` + optional overrides from D2).
- [ ] 3.3 When `autoReview` is set: create `CodeCommitAutoReviewer` (with `repositories: [repositoryName]`) + `CodeCommitReviewEvents` targeting its router. When absent: create `CodeCommitReviewEvents` with the consumer-supplied `router` (current behavior).
- [ ] 3.4 Export `CodeCommit` and `CodeCommitAutoReviewer` from `packages/cdk/index.ts`.
- [ ] 3.5 Write construct tests (`packages/cdk/tests/codecommit.test.ts`): autoReview on → full reviewer stack; off → router required.
- [ ] 3.6 Run gates in `packages/cdk/`.

### Task 4: Collapse the app to a thin consumer

- [ ] 4.1 Rewrite `durable-lambda-reviewer/stacks/reviewer-stack.ts` to use `CodeCommit` per repo (thin consumer from D6).
- [ ] 4.2 Delete `durable-lambda-reviewer/src/`.
- [ ] 4.3 Update `durable-lambda-reviewer/tests/security/synth-security.test.ts` to assert against the new construct's resources (IAM assertions stay; resource paths change).
- [ ] 4.4 Run all app gates: `bun test`, `bunx tsc --noEmit`, `oxlint`, `oxfmt --check`, `cdk synth --quiet`, `bun install --frozen-lockfile`.
- [ ] 4.5 Verify synth output matches prior stack (same resources, same IAM) via `cdk diff`.

### Task 5: Live validation

- [ ] 5.1 Deploy the collapsed app stack to `durable-reviewer-demo`.
- [ ] 5.2 Verify no CloudFormation drift (no resource replacement).
- [ ] 5.3 Open a fresh PR, post a comment, verify: 👀 reaction → conversational reply → 👍 reaction (full workflow through the construct).
- [ ] 5.4 Run live AWS integration tests (`RUN_AWS_INTEGRATION=1`).

### Task 6: Documentation

- [ ] 6.1 Update `docs/operations/deploy.md` for construct-based deployment.
- [ ] 6.2 Add JSDoc + README section for `CodeCommit` and the `autoReview` flag.

---

## Execution preconditions

- Pawl on branch `feat/cli-harness-extraction` (or a new `feat/codecommit-construct` branch off it). Existing Pawl fixes (KMS key policy, BatchGetBuilds scope, `grantComment` reply/reaction actions) preserved.
- App `main` HEAD has conversation-memory + 👍 reaction + beginCycle fix commits.
- All gates pass (264 tests, tsc/lint/fmt/synth clean) in both repos.
- Deployed stack `DurableLambdaReviewerStack` is live on `durable-reviewer-demo` — Task 5 must not disrupt it.

## Risks

- **`@pawl/cdk` package weight:** Adding runtime SDK deps increases install size for all `@pawl/cdk` consumers, even those not using `autoReview`. Mitigation: the deps are only bundled into the reviewer Lambdas (esbuild tree-shakes); non-reviewer consumers' Lambda bundles are unaffected. If this is a concern, the runtime could be a peer dep or the entry points could be optional.
- **Entry path resolution:** `path.resolve(__dirname, "reviewer/handlers/reviewer.ts")` must resolve at synth time. Since the files are inside `@pawl/cdk` itself, this is reliable as long as the package isn't restructured. The `tsconfig.build.json` must include the `reviewer/` dir in its compilation output (or the entry references the `.ts` source, which `NodejsFunction` handles via esbuild).
- **cdk-nag suppressions:** The Bedrock wildcard suppression moves into the construct and must pass synth with nag checks.
- **Test migration:** ~264 tests move to `packages/cdk/tests/reviewer/`. Import paths and `bun:test` setup must be verified.
- **Lockfile:** Adding runtime deps to `@pawl/cdk` shifts `bun.lock` at the Pawl root.
