# Oxc Tooling Migration Design

## Goal

Use Oxlint and Oxfmt as the durable-lambda-reviewer app's checked-in linting and formatting tools. Pawl's existing Biome tooling is out of scope.

## Current State

The app has no ESLint or Prettier dependency, configuration, or package scripts. Prettier has only been invoked ad hoc during development. The migration therefore establishes Oxc as the first project-owned lint and format toolchain rather than translating an existing ruleset.

## Design

Add the current exact `oxlint` and `oxfmt` releases to `devDependencies` and update `bun.lock`. Use the official zero-configuration defaults rather than introducing project-specific rules without an existing policy.

Add these package scripts following the official Oxc quickstarts:

- `lint`: `oxlint`
- `lint:fix`: `oxlint --fix`
- `fmt`: `oxfmt`
- `fmt:check`: `oxfmt --check`

Both tools run from the repository root. Their default Git-ignore handling excludes generated and dependency content. Add configuration only if execution reveals a repository path that must be excluded and is not already ignored; if required, use checked-in `ignorePatterns` rather than legacy ESLint or Prettier ignore files.

## Migration and Findings

Run `lint:fix` for safe automated lint fixes and `fmt` for formatting. Do not apply Oxlint suggestion or dangerous-fix modes automatically. Inspect and manually correct remaining lint findings so behavior remains unchanged. Oxfmt's output becomes the formatting baseline, including any repository-wide differences from ad hoc Prettier output.

## Verification

The migration is complete when:

1. `bun run lint` exits successfully with no findings.
2. `bun run fmt:check` exits successfully.
3. `bun test` passes.
4. `bunx tsc --noEmit` passes.
5. `bun install --frozen-lockfile` reports no lockfile changes.
6. `git diff --check` passes.
7. A final app diff review confirms every source-file change is an intended lint or format correction with no behavior change.
8. Pawl's HEAD and tracked-file status remain unchanged from the pre-migration snapshot; no `../pawl` file is part of the app diff.
9. No ESLint or Prettier dependencies, configurations, ignore files, or package-script references remain in the app.

## References

- [Oxlint usage](https://oxc.rs/docs/guide/usage/linter.html)
- [Oxlint quickstart](https://oxc.rs/docs/guide/usage/linter/quickstart.html)
- [Oxfmt usage](https://oxc.rs/docs/guide/usage/formatter.html)
- [Oxfmt quickstart](https://oxc.rs/docs/guide/usage/formatter/quickstart.html)
