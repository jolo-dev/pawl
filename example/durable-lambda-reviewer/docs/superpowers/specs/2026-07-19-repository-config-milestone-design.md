# Repository Config Loading Milestone Design

**Date:** 2026-07-19
**Status:** Draft — pending user approval
**Milestone:** Sixth of the durable reviewer feature implementation (master plan Task 12 config slice)

## 1. Purpose

Load the actual `.pawl/reviewer.json` from the reviewed repository at the immutable destination commit and use it throughout the review cycle, replacing the hardcoded `DEFAULT_REPOSITORY_CONFIG`. This is the last runtime gap: with all stubs replaced (CodeBuild checks, Bedrock model, reconciler), the reviewer currently still runs with empty checks and default limits because the workflow never reads the per-repository config. After this milestone, a repository's `.pawl/reviewer.json` drives the checks, review limits, and model ID.

## 2. Confirmed decisions

- **Config path:** `.pawl/reviewer.json`, read via `provider.getFile(ref, snapshot.destinationRevision, ".pawl/reviewer.json")` at the **destination commit** (the master plan's "exact destination commit reads" — the config is part of the protected mainline, not the PR source). Reading at the destination commit prevents a PR from weakening its own review policy.
- **Safe defaults on absence/malformed.** If the file is absent (`getFile` returns `undefined`) or fails to parse, the loader returns `DEFAULT_REPOSITORY_CONFIG` (the schema's defaults: empty checks, default limits, `modelId: "configured-default"`). A malformed config is logged as a warning but does **not** fail the review — the reviewer falls back to safe defaults and proceeds. This matches the master plan's "missing config safe defaults vs configured fail-closed policy" (safe-defaults side).
- **No model allowlist enforcement this milestone.** The master plan mentions a "model allowlist" — the stack defines a default model (`anthropic.claude-opus-4-8` via `REVIEWER_MODEL_ID`), and the config's `modelId` is currently informational (the Bedrock adapter uses the env-var model ID, not the config's). Enforcing a config-model-against-an-allowlist is deferred; this milestone loads the config and threads it through, but the model ID still comes from the stack env var. A follow-up can let the config override the model within an allowlist.
- **Config is loaded once per cycle, inside the durable `load-snapshot` step.** The loaded config is part of the `ReviewCycleSnapshot` context (added as a `repositoryConfig` field on the workflow's loaded context, not on the snapshot schema itself — the snapshot schema stays unchanged). Replay safety: the load is inside `context.step`, so on replay the cached config is returned without re-reading.
- **No new ports.** A `RepositoryConfigLoader` service wraps `provider.getFile` + `repositoryConfigSchema.parse`. The workflow depends on it (injected), defaulting to a `ProviderRepositoryConfigLoader` in the env path.
- **No IAM change.** `provider.getFile` uses `codecommit:GetFile`, which the reviewer role already has (`events.grantConfigRead(reviewer)` from the router milestone).
- **No live-AWS tests.** Fake `SourceControlProvider` returning canned file contents.

## 3. Scope

### 3.1 In scope

- `src/services/repository-config-loader.ts`: `RepositoryConfigLoader` port + `ProviderRepositoryConfigLoader` (reads `.pawl/reviewer.json` at the destination commit, parses, falls back to defaults).
- `tests/unit/repository-config-loader.test.ts`: present+valid config, absent file, malformed JSON, schema-invalid config, read at destination commit.
- `src/workflows/reviewer-workflow.ts`: load the config in the `load-snapshot` step via the injected loader; thread it into `checkRunner.run` (checks + install) and `reviewEngine.review` (repositoryConfig).
- `src/handlers/durable-reviewer-handler.ts`: env path constructs `ProviderRepositoryConfigLoader({ provider })` and passes it to the workflow.
- `tests/unit/workflows/reviewer-workflow.test.ts`: update the fake provider to return `undefined` from `getFile` (defaults) so the existing happy path still works.

### 3.2 Out of scope

- Model allowlist enforcement, `.pawl/reviewer.json` schema versioning beyond the existing `version: 1` literal, multi-repo stack assembly (Task 16), AWS integration tests (Task 17), config-file fixtures beyond the test's inline JSON.

## 4. Architecture

### 4.1 RepositoryConfigLoader

```ts
export interface RepositoryConfigLoader {
  load(ref: RequestRef, destinationRevision: string): Promise<RepositoryConfig>;
}

export class ProviderRepositoryConfigLoader implements RepositoryConfigLoader {
  constructor({ provider, logger }: { provider: SourceControlProvider; logger?: LoaderLogger });
  async load(ref, destinationRevision): Promise<RepositoryConfig> {
    const raw = await this.provider.getFile(ref, destinationRevision, ".pawl/reviewer.json");
    if (raw === undefined) return DEFAULT_REPOSITORY_CONFIG;
    try {
      const parsed = JSON.parse(raw);
      return repositoryConfigSchema.parse(parsed);
    } catch (error) {
      this.logger?.warn("repository config parse failed; using defaults", { error });
      return DEFAULT_REPOSITORY_CONFIG;
    }
  }
}
```

`DEFAULT_REPOSITORY_CONFIG = repositoryConfigSchema.parse({ version: 1 })` (the existing constant, moved/shared).

### 4.2 Workflow integration

The `load-snapshot` step currently loads `reviewRequest` + `changedFiles` + `humanComments` + `existingFindings`. It gains a `repositoryConfig` load:

```ts
const repositoryConfig = await this.#deps.configLoader.load(
  request,
  reviewRequest.destinationRevision,
);
```

The loaded `repositoryConfig` replaces `DEFAULT_REPOSITORY_CONFIG` in:

- `checkRunner.run({ ..., checks: repositoryConfig.checks, installCommand: repositoryConfig.install?.command })`
- `reviewEngine.review({ ..., repositoryConfig })`

### 4.3 Handler integration

`ReviewerWorkflowDeps` gains `configLoader: RepositoryConfigLoader`. The env path constructs `new ProviderRepositoryConfigLoader({ provider, logger })`. The injected/test path defaults to a loader that returns `DEFAULT_REPOSITORY_CONFIG` (or accepts an override).

## 5. File responsibilities

### 5.1 New application files

- `src/services/repository-config-loader.ts`: `RepositoryConfigLoader` port, `ProviderRepositoryConfigLoader`, `DEFAULT_REPOSITORY_CONFIG` (moved here from the workflow, shared).

### 5.2 Modified application files

- `src/workflows/reviewer-workflow.ts`: add `configLoader` to deps; load config in `load-snapshot`; thread into check runner + engine.
- `src/handlers/durable-reviewer-handler.ts`: construct + inject `ProviderRepositoryConfigLoader`.
- `tests/unit/workflows/reviewer-workflow.test.ts`: fake provider's `getFile` returns `undefined`.

### 5.3 New test files

- `tests/unit/repository-config-loader.test.ts`

## 6. Testing strategy

### 6.1 Loader unit test

Fake `SourceControlProvider` with configurable `getFile` return. Cases:

1. **Present + valid**: `getFile` returns valid JSON → loader returns the parsed config (non-default checks/limits).
2. **Absent**: `getFile` returns `undefined` → returns `DEFAULT_REPOSITORY_CONFIG`.
3. **Malformed JSON**: `getFile` returns `"not json"` → returns defaults; logger warned.
4. **Schema-invalid**: `getFile` returns `{ "version": 99 }` → returns defaults; logger warned.
5. **Read at destination commit**: assert `getFile` was called with `destinationRevision` (not `sourceRevision`).

### 6.2 Workflow regression

The existing workflow tests pass with `getFile → undefined` (defaults), proving no regression.

## 7. Acceptance criteria

1. `src/services/repository-config-loader.ts` defines the `RepositoryConfigLoader` port + `ProviderRepositoryConfigLoader` reading `.pawl/reviewer.json` at the destination commit.
2. A present+valid config is parsed and threaded into the check runner (checks + install) and the review engine (limits).
3. An absent or malformed config falls back to safe defaults without failing the review.
4. The config is loaded inside the durable `load-snapshot` step (replay-safe).
5. The handler's env path constructs `ProviderRepositoryConfigLoader`.
6. `cdk synth` clean; existing 232 tests remain green; new loader tests added on top.
7. No Pawl library changes, no live AWS calls, no IAM changes.

## 8. Decisions (approved by user — use judgment on all 3)

1. **Config path.** `.pawl/reviewer.json`.
2. **Malformed-config behavior.** Safe-defaults + warn. A typo in a repository's config must not block its reviews; the loader falls back to `DEFAULT_REPOSITORY_CONFIG` and logs a warning.
3. **Model ID from config.** Deferred. The Bedrock adapter uses the env-var `REVIEWER_MODEL_ID` (stack default `anthropic.claude-opus-4-8`). Config-driven model selection within an allowlist is a follow-up; this milestone loads `review.modelId` and threads it through but does not yet use it.

---

**Once approved, I'll write the implementation plan** and implement it in the worktree `feat/repository-config-milestone`.
