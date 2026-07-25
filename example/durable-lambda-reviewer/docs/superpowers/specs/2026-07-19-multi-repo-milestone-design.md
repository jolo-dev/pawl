# Multi-Repository Stack Assembly Milestone Design

**Date:** 2026-07-19
**Status:** Draft — pending user approval
**Milestone:** Seventh of the durable reviewer feature implementation (master plan Task 16)

## 1. Purpose

Generalize the single-repository stack to the master plan's multi-repository design: **one shared durable reviewer, one shared router, one shared state table** — but **one CodeBuild project and one CodeCommit event construct per configured repository**. Today the stack, router handler, and reviewer handler are hardwired to a single `repositoryName` and a single `CODEBUILD_PROJECT_NAME`. After this milestone, a deployment configures a list of repositories and the reviewer resolves the correct CodeBuild project per PR at runtime.

## 2. Confirmed decisions

- **Context shape.** Replace `repositoryName: string` with `repositories: array<string>` (non-empty, each `[A-Za-z0-9._-]+`, unique). One `CodeBuildProject` + one `CodeCommitReviewEvents` per entry. Shared reviewer/router/table.
- **Per-repo CodeBuild project env vars.** `codeBuild.projectName` is a CDK Token (Pawl's `Project.projectName` is lazy), so it **cannot** be serialized into a single JSON map env var at synthesis time. Instead, emit **one env var per repo**: `CODEBUILD_PROJECT_<SAFE>` where `<SAFE> = repo.toUpperCase().replace(/[^A-Z0-9]/g, "_")`. Each env var independently resolves its token at deploy time. Total Lambda env is bounded to 4 KB; this supports ~50 repos comfortably. Documented as a known limit; SSM/DynamoDB config is a follow-up if exceeded.
- **Reviewer resolves the project at runtime.** The `CodeBuildCheckRunner` constructor changes from `projectName: string` to `projectNames: Readonly<Record<string, string>>` (repo → project). In `run()`, it looks up `input.request.repository`; if absent, returns `infrastructure-failure` with code `UNKNOWN_REPOSITORY`. The handler builds this record from `process.env` by scanning `CODEBUILD_PROJECT_*` env vars.
- **`REPOSITORY_NAME` env var is dropped** from both handlers. It was dead — the router derives the repo from the event; the reviewer derives it from the review request; `CodeCommitProvider` takes only `reviewerArn`. The `REPOSITORY_NAME` validation in `buildEventRouter`/`buildReviewerWorkflow` is removed.
- **`botArnPatterns`, `reviewerModelId`, `reviewerCodeBuildRegistryEndpoint` stay global** (shared across repos). Per-repo overrides are a follow-up.
- **No new IAM.** Per-repo `grantRunAndRead(reviewer)`, `events.grantRead/grantConfigRead/grantComment(reviewer)`, `events.grantRead/grantConfigRead(router)` are called in the per-repo loop. Pawl scopes each to the repo's resources.
- **Router needs no per-repo config.** `CodeCommitReviewEvents` per repo targets the shared router. The router derives the repository from each event's detail — no env change beyond dropping `REPOSITORY_NAME`.
- **No raw CDK imports in `stacks/`.** The stack already imports only from `@pawl/cdk` (+ `aws-cdk-lib/aws-iam` for the Bedrock PolicyStatement, which the master plan's "allowed imports" permits as an application-level IAM grant — this was already reviewed and accepted in the Bedrock milestone).

## 3. Scope

### 3.1 In scope

- `stacks/reviewer-stack.ts`: `repositories` array; per-repo `CodeBuildProject` + `CodeCommitReviewEvents` loop; per-repo env vars on the reviewer; drop single `REPOSITORY_NAME`.
- `src/adapters/codebuild-check-runner.ts`: constructor takes `projectNames: Record<string, string>`; `run()` resolves by `input.request.repository`.
- `src/handlers/durable-reviewer-handler.ts`: build `projectNames` from `CODEBUILD_PROJECT_*` env vars; drop `CODEBUILD_PROJECT_NAME` / `REPOSITORY_NAME`.
- `src/handlers/event-router-handler.ts`: drop `REPOSITORY_NAME` validation.
- `cdk.json`: `repositories` array replaces `repositoryName`.
- `tests/constructs/reviewer-stack.test.ts`: assert N projects, N event constructs, 1 reviewer, 1 router, 1 table, per-repo env vars + IAM.
- `tests/unit/codebuild-check-runner.test.ts`: update constructor; add unknown-repository case.

### 3.2 Out of scope

- Per-repo `botArnPatterns` / `reviewerModelId` / registry endpoint overrides, SSM/DynamoDB config store, AWS integration tests (Task 17), operational docs (Task 17).

## 4. Architecture

### 4.1 Stack config

```ts
const StackConfigSchema = z.object({
  repositories: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .regex(/^[A-Za-z0-9._-]+$/),
    )
    .min(1),
  reviewerAlias: z.string().trim().min(1).default("live"),
  reviewerExecutionTimeoutSeconds: z.number().int().min(1).max(31_622_400).default(2_592_000),
  reviewerRetentionDays: z.number().int().min(1).max(90).default(14),
  reviewerModelId: z.string().trim().min(1).default("anthropic.claude-opus-4-8"),
  reviewerCodeBuildRegistryEndpoint: z
    .string()
    .trim()
    .url()
    .refine((v) => v.startsWith("https://"))
    .default("https://registry.npmjs.org"),
  botArnPatterns: z.string().default(""),
});
```

### 4.2 Per-repo loop

```ts
const reviewerEnv: Record<string, string> = { /* shared vars */ };
for (const repo of config.repositories) {
  const codeBuild = new CodeBuildProject(this, `Checks-${repo}`, { repositoryName: repo, ... });
  codeBuild.grantRunAndRead(reviewer);
  reviewerEnv[projectEnvVar(repo)] = codeBuild.projectName;

  const events = new CodeCommitReviewEvents(this, `Events-${repo}`, { repositoryName: repo, router });
  events.grantRead(router); events.grantConfigRead(router);
  events.grantRead(reviewer); events.grantConfigRead(reviewer); events.grantComment(reviewer);
}
reviewer.lambda.addEnvironment(...) // batch-set per-repo vars
```

The reviewer construct must be created **before** the loop (it needs the shared env vars + the per-repo vars are added after). `grantRunAndRead` and `events.grant*` target the already-created reviewer/router roles — fine.

**Ordering:** `stateTable` → `reviewer` (shared env only, no per-repo vars yet) → per-repo loop (creates projects + events, grants, adds per-repo env vars to reviewer) → `router` → router grants. Actually the reviewer env must be complete before the construct finishes; CDK allows adding env vars after construct creation via `reviewer.lambda.addEnvironment(key, value)`.

### 4.3 Env var encoding

```ts
function projectEnvVar(repository: string): string {
  return `CODEBUILD_PROJECT_${repository.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}
```

### 4.4 CodeBuildCheckRunner

```ts
constructor(options: { transport: CodeBuildTransport; projectNames: Readonly<Record<string, string>>; ... }) { ... }
async run(input: CheckRunInput): Promise<CheckRunResult> {
  const projectName = this.#projectNames[input.request.repository];
  if (projectName === undefined) return { status: "infrastructure-failure", code: "UNKNOWN_REPOSITORY", message: `no CodeBuild project for repository ${input.request.repository}`, retryable: false };
  ...
}
```

### 4.5 Handler

```ts
function codeBuildProjectsFromEnv(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("CODEBUILD_PROJECT_")) {
      const repo = key.slice("CODEBUILD_PROJECT_".length).toLowerCase().replace(/_/g, "-");
      // NOTE: lossy reverse — see §6.2. We also store a forward map via a companion env var.
    }
  }
  return map;
}
```

**Lossy-reverse problem:** the env var name encoding (`_` for all non-alphanumerics) is lossy (`my.repo` and `my_repo` map to the same key). To avoid this, the handler does **not** reverse-engineer the repo name from the env var. Instead, the stack also sets a `CODEBUILD_REPOSITORIES` env var (comma-separated repo list), and the handler iterates that list, encoding each repo to find its env var. This is exact and non-lossy.

```ts
function codeBuildProjectsFromEnv(): Record<string, string> {
  const repos = (process.env.CODEBUILD_REPOSITORIES ?? "").split(",").filter(Boolean);
  const map: Record<string, string> = {};
  for (const repo of repos) {
    const name = process.env[projectEnvVar(repo)];
    if (name) map[repo] = name;
  }
  return map;
}
```

The stack sets `CODEBUILD_REPOSITORIES = config.repositories.join(",")` on the reviewer.

## 5. File responsibilities

(As listed in §3.1.)

## 6. Testing strategy

### 6.1 Construct test

With `repositories: ["repo-a", "repo-b"]`:

- Exactly 2 `AWS::CodeBuild::Project` resources.
- Exactly 2 `AWS::Events::Rule` resources (one per repo's `CodeCommitReviewEvents`).
- 1 reviewer Lambda, 1 router Lambda, 1 DynamoDB table.
- Reviewer env has `CODEBUILD_PROJECT_REPO_A` + `CODEBUILD_PROJECT_REPO_B` + `CODEBUILD_REPOSITORIES = "repo-a,repo-b"`.
- Reviewer role has `codebuild:StartBuild` scoped to both projects' ARNs.
- Router/reviewer have per-repo `codecommit:Get*`/`PostComment*` scoped to both repos.

### 6.2 Adapter test

- Existing tests updated: `projectNames: { "repo": "test-project" }`.
- New: unknown repository → `infrastructure-failure` with `UNKNOWN_REPOSITORY`.

### 6.3 Handler test

- `buildReviewerWorkflow` with `CODEBUILD_REPOSITORIES="repo-a,repo-b"` + `CODEBUILD_PROJECT_REPO_A=pa` + `CODEBUILD_PROJECT_REPO_B=pb` → the workflow's check runner resolves `repo-a → pa`.

## 7. Acceptance criteria

1. Stack accepts a `repositories` array and synthesizes one CodeBuild project + one event construct per repo, with one shared reviewer/router/table.
2. Reviewer env carries one `CODEBUILD_PROJECT_<SAFE>` per repo + `CODEBUILD_REPOSITORIES`; no single `REPOSITORY_NAME`/`CODEBUILD_PROJECT_NAME`.
3. `CodeBuildCheckRunner` resolves the project by `input.request.repository`; unknown repo → `infrastructure-failure`.
4. Router handler no longer requires `REPOSITORY_NAME`.
5. `cdk synth` clean; construct + unit tests green; no Pawl changes; no live AWS.
6. No raw CDK imports in `stacks/` beyond the accepted `aws-cdk-lib/aws-iam` PolicyStatement.

## 8. Decisions (approved by user — use judgment on all 4)

1. **Env var per repo** (vs. JSON map — blocked by CDK Token serialization; vs. SSM/DynamoDB — follow-up). Adopted.
2. **`CODEBUILD_REPOSITORIES` companion env var** for exact (non-lossy) repo→project resolution. Adopted.
3. **Global `botArnPatterns`/`modelId`/`registryEndpoint`** (per-repo overrides deferred). Adopted.
4. **`repositories` min(1)** — a deployment must configure at least one repo. Adopted.
