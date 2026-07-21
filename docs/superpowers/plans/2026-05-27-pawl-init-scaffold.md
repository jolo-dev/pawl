# pawl init Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `pawl init` workflow that scaffolds a new pawl project from scratch using Clack prompts, with required project name input, package manager selection, AWS profile selection, and optional LocalStack-only local testing setup.

**Architecture:** Build `pawl init` as a deterministic scaffold generator that writes a complete starter project from template files and user answers. The command should refuse to run in a non-empty target directory, prompt for all required inputs up front, then materialize a tutorial-style project structure with files customized to the chosen project name, package manager, AWS profile, and test mode. The LocalStack path should generate additional local-dev/test helpers; the `none` path should generate only the minimal project skeleton.

**Tech Stack:** Bun, TypeScript, Clack (`@clack/prompts`), pawl CLI, `@pawl/cdk`, `@pawl/lambda`, AWS CDK LocalStack support

**Feature scope:**
- `pawl init` scaffolds a new project
- Mandatory prompts:
  - project name (no default; user must enter one)
  - package manager: `bun` (recommended), `pnpm`, `npm` (not recommended)
  - AWS profile (chosen from local AWS profiles; saved into project config)
  - test mode: `LocalStack` or `none`
- Refuse to initialize if target directory is not empty
- Generated project should resemble `example/tutorial` but be customized from the user’s answers
- Generated project should include a `tests/` folder with a starter example (patterned after `packages/cdk/tests/integration`)
- Selected AWS profile must be written into `cdk.json` and into package scripts
- `LocalStack` mode should scaffold local dev/test files; `none` mode should omit them

**Target file layout after refactor:**

```
packages/cli/
├── index.ts                        # unchanged CLI bootstrap (except init wiring if needed)
├── src/
│   ├── commands.ts                 # add real /init implementation
│   ├── scaffold/
│   │   ├── index.ts                # new scaffold orchestration API
│   │   ├── prompts.ts              # new Clack prompt flow
│   │   ├── template.ts             # new template writer / interpolation helpers
│   │   ├── filesystem.ts           # new empty-dir check, write helpers
│   │   └── types.ts                # new scaffold config types
│   └── ...
├── templates/
│   └── pawl-init/                  # new file templates for scaffolded project
│       ├── package.json
│       ├── cdk.json
│       ├── tsconfig.json
│       ├── README.md
│       ├── index.ts
│       ├── stacks/stack.ts
│       ├── src/*
│       ├── tests/*
│       └── local.dev.ts            # only used when LocalStack selected
├── tests/
│   ├── scaffold.test.ts            # new tests for scaffold logic
│   └── fixtures/                  # new fixture directories for empty/non-empty target dirs
└── README.md                       # update docs for init workflow
```

---

### Task 1: Define scaffold config and validation rules

**Files:**
- Create: `packages/cli/src/scaffold/types.ts`
- Create: `packages/cli/src/scaffold/prompts.ts`
- Create: `packages/cli/tests/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests that describe the required init inputs and invalid states:

```typescript
import { describe, expect, test } from "bun:test";
import { validateScaffoldConfig } from "../src/scaffold";

describe("validateScaffoldConfig", () => {
	test("rejects missing project name", () => {
		expect(() => validateScaffoldConfig({ projectName: "" })).toThrow();
	});

	test("accepts bun as package manager", () => {
		const cfg = validateScaffoldConfig({
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "none",
		});
		expect(cfg.packageManager).toBe("bun");
	});

	test("rejects unsupported test mode", () => {
		expect(() => validateScaffoldConfig({
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "ministack",
		} as never)).toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: FAIL with `Cannot find module '../src/scaffold'` or missing export errors.

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/scaffold/types.ts` with:
- `ScaffoldPackageManager = "bun" | "pnpm" | "npm"`
- `ScaffoldTestMode = "localstack" | "none"`
- `ScaffoldConfig` interface containing `projectName`, `packageManager`, `awsProfile`, `testMode`, `projectDir`

Create `packages/cli/src/scaffold/prompts.ts` with Clack prompt helpers:
- `promptProjectName()` — required text input, no default
- `promptPackageManager()` — select with labels:
  - Bun (recommended)
  - pnpm
  - npm (not recommended)
- `promptAwsProfile(profiles: string[])`
- `promptTestMode()` — select with only `LocalStack` and `none`
- `confirmInit()` (optional final confirmation)

Create a `validateScaffoldConfig()` function that rejects empty names and invalid enums.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scaffold packages/cli/tests/scaffold.test.ts
git commit -m "feat(cli): add scaffold config and Clack prompt definitions"
```

---

### Task 2: Add empty-directory checks and scaffold orchestration entry point

**Files:**
- Create: `packages/cli/src/scaffold/filesystem.ts`
- Create: `packages/cli/src/scaffold/index.ts`
- Modify: `packages/cli/src/commands.ts`

- [ ] **Step 1: Write the failing test**

Add tests for refusing to scaffold into a non-empty directory and for returning a resolved scaffold config from the orchestration layer:

```typescript
import { describe, expect, test } from "bun:test";
import { assertEmptyTargetDir } from "../src/scaffold/filesystem";

describe("assertEmptyTargetDir", () => {
	test("throws when target dir contains files", () => {
		expect(() => assertEmptyTargetDir(["README.md"])).toThrow(/not empty/i);
	});

	test("allows empty dir", () => {
		expect(() => assertEmptyTargetDir([])).not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: FAIL until filesystem helper exists.

- [ ] **Step 3: Write minimal implementation**

Implement `assertEmptyTargetDir()` using Bun fs primitives or `node:fs`/`readdirSync`:
- throw if any non-hidden or hidden file exists except maybe `.git` (decide in code, but default should be refusal)
- keep message explicit: directory must be empty to initialize pawl

Implement `runPawlInit()` in `src/scaffold/index.ts`:
- list AWS profiles using existing `listProfiles()` helper
- prompt user via Clack
- validate target directory is empty
- return a `ScaffoldConfig`
- keep it reusable from `commands.ts`

Wire `commands.ts` to a real `/init` handler that invokes `runPawlInit()` and reports failures cleanly.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scaffold packages/cli/src/commands.ts
git commit -m "feat(cli): add init scaffold orchestration and empty-dir guard"
```

---

### Task 3: Create template files for the scaffolded pawl project

**Files:**
- Create: `packages/cli/templates/pawl-init/package.json`
- Create: `packages/cli/templates/pawl-init/cdk.json`
- Create: `packages/cli/templates/pawl-init/tsconfig.json`
- Create: `packages/cli/templates/pawl-init/README.md`
- Create: `packages/cli/templates/pawl-init/index.ts`
- Create: `packages/cli/templates/pawl-init/stacks/stack.ts`
- Create: `packages/cli/templates/pawl-init/src/sendWelcomeMessageHandler.ts`
- Create: `packages/cli/templates/pawl-init/src/messageProcessorHandler.ts`
- Create: `packages/cli/templates/pawl-init/tests/integration.test.ts`
- Create: `packages/cli/templates/pawl-init/local.dev.ts` (LocalStack-only)

- [ ] **Step 1: Write the failing test**

Add snapshot/structural tests that assert the template manifest includes the expected files for each mode:

```typescript
import { describe, expect, test } from "bun:test";
import { getTemplateManifest } from "../src/scaffold/template";

describe("template manifest", () => {
	test("includes local dev files for LocalStack", () => {
		const manifest = getTemplateManifest({ testMode: "localstack" });
		expect(manifest.files).toContain("local.dev.ts");
		expect(manifest.files).toContain("tests/integration.test.ts");
	});

	test("omits local dev file when test mode is none", () => {
		const manifest = getTemplateManifest({ testMode: "none" });
		expect(manifest.files).not.toContain("local.dev.ts");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: FAIL until template manifest exists.

- [ ] **Step 3: Write minimal implementation**

Create a manifest-based template writer in `src/scaffold/template.ts`:
- `getTemplateManifest(config)` returns file list based on test mode
- `renderTemplate(content, config)` replaces placeholders like `{{projectName}}`, `{{awsProfile}}`, `{{packageManager}}`
- `writeScaffoldFiles(targetDir, config)` writes all files

Template content should mirror `example/tutorial` but adapt to user input:
- `package.json` scripts must include `AWS_PROFILE=<profile>` (or cross-platform equivalent)
- `cdk.json` must include AWS profile in context and/or app command
- project name and stack identifiers should derive from user input
- README should describe the chosen package manager and LocalStack/none mode

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/templates/pawl-init packages/cli/src/scaffold/template.ts
git commit -m "feat(cli): add pawl init scaffold templates"
```

---

### Task 4: Scaffold test folder and example integration test

**Files:**
- Create: `packages/cli/templates/pawl-init/tests/`
- Create: `packages/cli/templates/pawl-init/tests/integration.test.ts`
- Modify: `packages/cli/src/scaffold/template.ts`

- [ ] **Step 1: Write the failing test**

Add tests that verify a starter test file exists and differs by mode:

```typescript
import { describe, expect, test } from "bun:test";
import { getTemplateManifest } from "../src/scaffold/template";

describe("test scaffold", () => {
	test("always creates tests folder and example test", () => {
		const manifest = getTemplateManifest({ testMode: "none" });
		expect(manifest.files).toContain("tests/integration.test.ts");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: FAIL until test template exists.

- [ ] **Step 3: Write minimal implementation**

Create a starter integration test modeled after `packages/cdk/tests/integration/*`:
- explain how to run local integration tests
- if `LocalStack`, use `local.dev.ts` and localstack setup script
- if `none`, keep a placeholder test with a TODO for manual deployment

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/templates/pawl-init/tests packages/cli/src/scaffold/template.ts
git commit -m "feat(cli): scaffold starter tests folder for pawl init"
```

---

### Task 5: Wire the `pawl init` command into the CLI and document it

**Files:**
- Modify: `packages/cli/src/commands.ts`
- Modify: `packages/cli/README.md`
- Modify: `packages/cli/index.ts` (only if needed for CLI messaging)

- [ ] **Step 1: Write the failing test**

Add a command-level test that ensures `/init` exists and calls the scaffold flow:

```typescript
import { describe, expect, test } from "bun:test";
import { pawlCommands } from "../src/commands";

describe("pawlCommands", () => {
	test("registers init command", () => {
		// verify command registration list contains init
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/cli && bun test tests/*.test.ts -v
```
Expected: FAIL until init is fully wired.

- [ ] **Step 3: Write minimal implementation**

Implement the actual command logic:
- `/init` should prompt for name, package manager, AWS profile, test mode
- refuse non-empty directories
- write scaffold files using template engine
- print next-step instructions after generation

Update README to document:
- `pawl init`
- required prompts
- LocalStack/none behavior
- package manager choices
- note that AWS profile is saved in `cdk.json` and package scripts

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/cli && bun test
bun lint
```
Expected: PASS and lint clean for changed files.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands.ts packages/cli/README.md packages/cli/index.ts
git commit -m "feat(cli): add pawl init command and docs"
```

---

### Task 6: Final verification and sample generation check

**Files:**
- All scaffold-related files

- [ ] **Step 1: Write the failing test**

Add a smoke test that scaffolding a sample project produces the expected files for a LocalStack project and refuses a non-empty directory.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/cli && bun test tests/scaffold.test.ts -v
```
Expected: FAIL until end-to-end scaffolding behavior is complete.

- [ ] **Step 3: Write minimal implementation**

Verify end-to-end generation of at least one scaffold example:
- project name replacement
- package manager-specific scripts
- AWS profile propagation to `cdk.json` and `package.json`
- LocalStack file inclusion only when selected
- refusal on non-empty dir

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/cli && bun test
bun lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/templates/pawl-init packages/cli/src/scaffold packages/cli/tests
git commit -m "chore(cli): finalize pawl init scaffold verification"
```

---

## Dependency graph

```
Task 1 (config + prompts) ──→ Task 2 (orchestration + guard) ──→ Task 3 (templates)
                                                            │
                                                            ├──→ Task 4 (tests folder)
                                                            ├──→ Task 5 (CLI wiring + docs)
                                                            └──→ Task 6 (final verification)
```

Tasks 1–3 are sequential. Tasks 4–5 can follow once templates exist. Task 6 depends on all prior tasks.
