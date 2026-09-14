# Project-local startup settings

## Approved experience

The user approved project-local saved settings and a short Clack overview instead of repeating every startup question. Keep Clack before OpenTUI. Preserve all `pawl init` subcommands and the existing chat UI.

- First launch: run the existing AWS/profile/region/model wizard and save only after successful validation.
- Subsequent launches: show the saved profile, region, model name and exact model/inference-profile ID, then offer **Continue** (initial selection) or **Change settings**. Standard Clack cancellation exits without starting the runtime or modifying settings.
- Continue: validate the saved selection against the current environment, then start the session without repeating selection questions.
- Change settings: open the wizard with the saved choices preselected where still applicable, validate the replacement, then save it.
- Validation failure: explain the problem and offer **Change settings** or cancellation. Never silently choose another AWS profile, region, or model.

## Location and format

Resolve `.pawl/settings.json` against the project directory already used by `index.ts` (`process.cwd()` at startup). Do not search ancestor directories or use home-directory settings in this slice. Settings belong to each project independently.

Use a strict, versioned Zod schema:

```json
{
  "version": 1,
  "profile": "jolo",
  "region": "eu-central-1",
  "modelId": "eu.amazon.nova-2-lite-v1:0",
  "modelName": "Nova 2 Lite"
}
```

All four strings must be nonempty and contain no terminal control characters. Bound profile, model ID, and model name to 256 characters each, and region to 64 characters. Model name is a display cache only; exact `modelId` determines selection. Persist only these fields, never credentials, SSO tokens, access keys, runtime sessions, or other environment values. Derive provider/base-model defaults from current model groups rather than storing redundant selection state.

## Validation and recovery

On Continue, verify that the AWS profile still exists, refresh expired SSO login through the existing login/reporting path, and check resolved credentials for the selected profile/region. Apply equivalent credential checks after login on the first-run/edit path; an unexpired SSO token alone does not prove usable role credentials.

Refresh current Bedrock model groups and require the **exact saved model ID** to appear in the available scopes, not merely a matching base model. Run the existing Bedrock access check. Refresh the model display name from the matching live group. These checks establish discoverability and the current preflight access checks, not a guarantee that every subsequent InvokeModel call is authorized. Do not make a paid model invocation as a startup probe.

Handle missing profile, unavailable exact scope, empty catalog, AWS errors, expired/login-failed SSO, and profile-region lookup failures as explained preflight failures, not uncaught exceptions. Return to explicit reconfiguration or cancellation; preserve the old file on unsuccessful validation or cancelled editing.

A missing settings file means first run. Invalid JSON, invalid schema, unsupported version, and unreadable settings produce a notice and offer fresh configuration; never silently treat corruption as a valid saved selection. Leave the existing file intact until a replacement passes validation. A user who cancels does not lose the previous settings.

Saved defaults are applied only if valid in the current choices. Keep the saved region when editing the same profile; if the user changes profile, suggest that profile's configured region (or the existing fallback). Match saved provider/model/scope against each newly fetched catalog; unavailable defaults must not become selectable phantom options.

## Persistence and Git hygiene

Use Node filesystem APIs and the already installed Zod; add no dependencies.

Before writing settings, create or preserve `.pawl/.gitignore`, adding anchored rules for `/settings.json` and implementation-owned temporary settings files. Preserve existing rules and other `.pawl` content, including plans. Do not edit the consumer project's root `.gitignore`, Git index, or global ignore configuration. An ignore rule cannot untrack a previously tracked file: document this limitation rather than automatically running Git mutations.

Write validated settings through a uniquely named sibling temporary file with mode `0600`, then rename atomically; clean up a temporary file after failure. Do not overwrite the prior settings with a partial write. Refuse symlinked `.pawl` directories, settings files, or `.pawl/.gitignore` files with an actionable notice rather than reading/writing outside the expected project-local location.

If ignore setup or persistence fails, warn that the selection was **not saved**, preserve old settings where possible, and allow the successfully validated selection to run for this session. Do not claim persistence succeeded or start again at the selection wizard merely because disk writes failed. Cancellation or validation failure never writes settings. Continue with an unchanged valid selection need not rewrite the file; a refreshed model display name may be persisted after validation.

## Module boundaries

- `packages/cli/src/settings.ts`: schema, project-relative loading, atomic saving, and settings-specific Git-ignore protection. No AWS calls or terminal prompts. Tests use temporary project directories.
- `packages/cli/src/tui/preflight.ts`: retain the injectable wizard; add optional saved defaults and initial selection support without breaking first-run or Back/cancel behavior.
- `packages/cli/src/tui/preflight-validation.ts` if needed: share credential/SSO and model/access validation between Continue and wizard paths instead of duplicating auth policy.
- `packages/cli/src/tui/startup.ts`: coordinate load, overview/choice, validated reuse or editing, recovery and save notices. Inject persistence, existing `PreflightDeps`, and `PreflightPrompter` so state transitions are testable without AWS.
- `packages/cli/src/tui/clack-prompter.ts`: forward optional `initialValue` for selects. Keep output entirely on the pre-renderer path.
- `packages/cli/index.ts`: call the startup coordinator with the actual project directory and production adapters; launch OpenTUI/eve only on success. Preserve subcommand early exits.
- `packages/cli/README.md`: explain file location, saved fields, Continue/Change settings, deleting settings to reset, and Git-ignore limitations.

Avoid unrelated fixes to status-spinner semantics, launcher port ownership, CloudFormation-pane data, scaffolding, or provider selection.

## Acceptance tests

1. Two temporary project directories retain independent selections; a directory with no file still gets the original wizard.
2. Successful first run writes exactly the allowed versioned fields, ignores only settings/temp files, preserves existing ignore content and `.pawl/plan.md`, and leaves no temp files.
3. Valid saved settings show the overview before AWS checks, default to Continue, skip profile/region/provider/model/scope prompts, still check authentication/catalog/access, and launch with the validated values.
4. Change settings preselects valid saved choices and writes only after successful validation. Back navigation, changed profiles/regions, and missing defaults work without stale selections.
5. Both Continue and wizard paths refresh expired SSO as required and validate credentials afterward. No login for a valid token, but credentials are still checked.
6. Removed profile, removed exact model scope, credential/access failures, catalog errors and malformed settings produce actionable recovery. Cancellation and failed reconfiguration preserve the prior file and do not launch the runtime.
7. Read-only filesystem/ignore/write failures report unsaved settings but permit an otherwise validated session; atomic replacement protects old contents. Symlink paths fail safely.
8. Production Clack initial-selection wiring is tested, not only mocked prompt requests. Existing preflight, init, session, and native TUI suites remain green.

## Verification baseline

Latest CLI suite: 439 pass. Root `bun lint` passes. Root tests: 1390 pass, 8 skip, 4 failures associated with missing `LOCALSTACK_AUTH_TOKEN`. CLI typecheck has 50 existing errors outside the changed TUI paths. Run lint, CLI and root tests, typecheck, and `git diff --check`; distinguish unchanged baseline failures from introduced errors.

The checkout contains uncommitted model/TUI changes. Do not stage, reset, overwrite, or commit them as part of documentation/planning. Implementation must preserve those edits, especially the presenter, pulse, and startup runtime wiring already in `index.ts`.
