# Repository Configuration

Each reviewed repository may commit a `.pawl/reviewer.json` file at its root to
configure the reviewer's checks, install step, and review limits. The file is
read from the **destination commit** (the protected mainline), so a pull
request cannot weaken its own review policy.

## Schema

```jsonc
{
  "version": 1,
  "checks": [
    {
      "name": "types",
      "command": "bunx tsc --noEmit",
      "timeoutSeconds": 300,
    },
    {
      "name": "lint",
      "command": "bun run lint",
    },
  ],
  "install": {
    "command": "bun install --frozen-lockfile",
  },
  "review": {
    "maxChangedFiles": 100,
    "maxModelTokens": 100000,
  },
}
```

| Field                     | Type   | Default | Notes                                                      |
| ------------------------- | ------ | ------- | ---------------------------------------------------------- |
| `version`                 | `1`    | —       | Required. Schema version literal.                          |
| `checks`                  | array  | `[]`    | Checks run sequentially in CodeBuild at the source commit. |
| `checks[].name`           | string | —       | Human-readable check name.                                 |
| `checks[].command`        | string | —       | Shell command. Exit 0 = pass, non-zero = fail.             |
| `checks[].timeoutSeconds` | number | —       | Optional per-check timeout.                                |
| `install.command`         | string | —       | Optional install step run before checks.                   |
| `review.maxChangedFiles`  | number | default | Hard limit; review aborts if exceeded.                     |
| `review.maxModelTokens`   | number | default | Bedrock model token budget.                                |

## Safe-defaults behavior

- **Absent file:** the reviewer uses safe defaults (no checks, default limits).
- **Malformed JSON / schema-invalid:** the reviewer logs a warning and falls
  back to safe defaults. A typo does **not** block reviews.
- The config is loaded once per review cycle inside the durable `load-snapshot`
  step (replay-safe).

## Onboarding steps

1. Create `.pawl/reviewer.json` at the repository root on the mainline branch.
2. Commit and push.
3. Open a pull request — the reviewer reads the config from the destination
   commit and runs the configured checks.

## Model allowlist (deferred)

The `review.modelId` field is loaded but **not yet used**. The Bedrock model is
selected by the stack's `reviewerModelId` context variable (default
`anthropic.claude-opus-4-8`). Per-repository model selection within an
allowlist is a follow-up.

## Checks execution

Checks run in a dedicated CodeBuild project (one per repository) at the exact
source commit. The buildspec is generated from the configured checks; each
check's exit code is parsed from log markers. Logs are bounded (4 KB/check)
and scrubbed (AWS tokens/keys redacted) before being passed to the review model.
