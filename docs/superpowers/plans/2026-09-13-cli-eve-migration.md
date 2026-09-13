# pawl CLI: pi-coding-agent + Flue → eve Implementation Plan

> **Status: IMPLEMENTED** (2026-09-13). All tasks executed inline; commits `634a93a`..`bf5c5d0`. Verification: `bun lint` clean, 181 `packages/cli` tests pass, `eve info` reports 0 diagnostics with 3 skills / 16 tools / 3 subagents, `eve build` produces `.output`, and `eve dev --no-ui` accepts a session and resolves `amazon-bedrock/<model>` (fails only on missing AWS credentials). `bunx tsc --noEmit` reports 50 pre-existing errors, down from a 77-error baseline measured with the same config.
>
> Deviations from the plan below, all deliberate:
> - `FoundationModelLike` also carries `inputModalities`; `init_project` exports its zod schema so tests can validate input without eve's wrapper.
> - A `src/project-dir.ts` seam was added. The plan assumed tools could use `process.cwd()`, but eve resolves its app root by walking up for `agent/`, so the launcher must run from the package root while the agent works on the user's project. `PAWL_PROJECT_DIR` carries the split.
> - `src/codecommit-init/prompts.ts` also imported the undeclared `@earendil-works/pi-ai`; it now offers a curated Anthropic list instead of the pi-ai catalog.
> - The eve sandbox cannot reach the host project, so the design keeps all pawl work in authored tools (app runtime) and leaves the sandbox to eve's built-in file tools.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@earendil-works/pi-coding-agent` and `@flue/runtime` in `packages/cli` with the `eve` framework (Vercel), keeping AWS Bedrock as the model provider and preserving the existing CLI workflows.

**Architecture:** `packages/cli` becomes an eve app root. `agent/` holds the authored surface (instructions, tools, skills, subagents, channel). `src/` keeps the runtime-agnostic core (`PawlHarness`, `aws-credentials`, `diagram`, `scaffold`, `codecommit-init`, `codepipeline-init`). `index.ts` stays a launcher that performs the AWS/Bedrock pre-flight and then hands off to `eve dev`. Authored eve tools execute in the **app runtime** (host) — not the sandbox — so they can drive `PawlHarness` against the user's actual project directory. eve's sandbox stays on its default backend and serves the built-in `bash`/`read_file`/`write_file` tools only.

**Tech Stack:** Bun (package manager, test runner), TypeScript, eve 0.54.x, `ai` v7, `@ai-sdk/amazon-bedrock` (direct provider `LanguageModel`), Zod 4, AWS SDK (Bedrock/SSO/STS), cdk-nag-adjacent `@pawl/cdk`.

**Decisions locked with the owner:**
1. Model stays **AWS Bedrock** via `@ai-sdk/amazon-bedrock` (not Vercel AI Gateway).
2. Scope is the **full** migration in one pass (code + tests + docs).
3. `packages/cli` **is** the eve app root.
4. **Node 24** bump for `packages/cli`.

---

## File Structure

### Created
| Path | Responsibility |
| --- | --- |
| `packages/cli/agent/agent.ts` | Root agent config: Bedrock model, context window, reasoning, limits |
| `packages/cli/agent/instructions.md` | Identity + AWS scope guard + two-phase (plan → approve → generate) workflow |
| `packages/cli/agent/channels/eve.ts` | Built-in eve HTTP channel (`vercelOidc` + `localDev`), replaces Flue's `/agents/*` |
| `packages/cli/agent/tools/plan.ts` | Emits the infrastructure-planning task (was `/plan`) |
| `packages/cli/agent/tools/generate.ts` | Emits the CDK generation task (was `/generate`); gated by `always()` approval |
| `packages/cli/agent/tools/well_architected.ts` | Emits the Well-Architected review task (was `/well-architected`) |
| `packages/cli/agent/tools/cost.ts` | Emits the cost-optimization task (was `/cost`) |
| `packages/cli/agent/tools/architecture.ts` | Renders the plan's Mermaid diagram to ASCII (was `/architecture`) |
| `packages/cli/agent/tools/init_project.ts` | Runs `runPawlInit` + `writeScaffoldProject` (was `/init`) |
| `packages/cli/agent/subagents/planner/{agent.ts,instructions.md}` | Declared subagent replacing Flue `agents/plan.ts` |
| `packages/cli/agent/subagents/generator/{agent.ts,instructions.md}` | Declared subagent replacing Flue `agents/generate.ts` |
| `packages/cli/agent/subagents/well-architected/{agent.ts,instructions.md}` | Declared subagent replacing Flue `agents/well-architected.ts` |
| `packages/cli/src/bedrock-models.ts` | Bedrock foundation-model + inference-profile catalog for the launcher picker (replaces `getModels("amazon-bedrock")` from `@earendil-works/pi-ai`) |
| `packages/cli/src/host-exec.ts` | `ExecFn` backed by the host (Bun `$`), wiring `PawlHarness` into eve tools |
| `packages/cli/src/launch.ts` | Spawns `eve dev` with the resolved AWS env |
| `packages/cli/tests/bedrock-models.test.ts` | Unit tests for the catalog grouping |
| `packages/cli/tests/host-exec.test.ts` | Unit tests for the host exec adapter |
| `packages/cli/tests/agent-tools.test.ts` | Unit tests for the migrated tools |
| `packages/cli/tests/agent-config.test.ts` | Asserts `agent.ts` wires Bedrock + required fields, and that `agent/` has no stale imports |

### Moved
| From | To |
| --- | --- |
| `packages/cli/skills/pawl-plan/SKILL.md` | `packages/cli/agent/skills/pawl-plan/SKILL.md` |
| `packages/cli/skills/pawl-codegen/SKILL.md` | `packages/cli/agent/skills/pawl-codegen/SKILL.md` |
| `packages/cli/skills/pawl-constructs/SKILL.md` | `packages/cli/agent/skills/pawl-constructs/SKILL.md` |

### Modified
| Path | Change |
| --- | --- |
| `package.json` (root) | Drop the `patchedDependencies` entry for pi-coding-agent; add `eve`, `ai`, `@ai-sdk/amazon-bedrock` to the workspace catalog |
| `packages/cli/package.json` | Swap deps; add `engines.node: 24.x`; add eve scripts |
| `packages/cli/index.ts` | Keep the AWS pre-flight, replace the pi-ai model picker with `src/bedrock-models.ts`, replace `startAgent` with `launchEveDev` |
| `packages/cli/tsconfig.json` | Add `types: ["node", "eve/workflow-modules"]`, include `agent/**` |
| `packages/cli/README.md` | New architecture/usage sections |
| `AGENTS.md` (root) | Update the CLI package description and stack |
| `packages/cli/.gitignore` | Add eve build output dirs (create the file if absent) |

### Deleted
| Path | Reason |
| --- | --- |
| `packages/cli/src/infra-agent.ts` | pi-coding-agent session runtime + `InteractiveMode` |
| `packages/cli/src/commands.ts` | pi-coding-agent `ExtensionFactory` slash commands |
| `packages/cli/src/aws-guard.ts` | pi-coding-agent `before_agent_start` hook (now instructions) |
| `packages/cli/agents/plan.ts` | Flue agent |
| `packages/cli/agents/generate.ts` | Flue agent |
| `packages/cli/agents/well-architected.ts` | Flue agent |

---

## Task 0: Dependency swap and eve install

**Files:**
- Modify: `package.json`, `packages/cli/package.json`
- Create: `packages/cli/.gitignore`

- [ ] **Step 1: Remove the stale pi-coding-agent patch from the root manifest**

In `/Users/jolo/Development/pawl/package.json`, delete the whole `patchedDependencies` block (it patches `@earendil-works/pi-coding-agent@0.74.0`, which no longer exists once the dependency is gone):

```json
"patchedDependencies": {
	"@earendil-works/pi-coding-agent@0.74.0": "patches/@earendil-works%2Fpi-coding-agent@0.74.0.patch"
}
```

- [ ] **Step 2: Add the new packages to the workspace catalog**

In `/Users/jolo/Development/pawl/package.json` → `workspaces.catalog`, add:

```json
"@ai-sdk/amazon-bedrock": "5.0.82",
"ai": "7.0.99",
"eve": "0.54.3"
```

(`zod` is already catalogued at `4.4.3`, which satisfies both eve and the Bedrock provider.)

- [ ] **Step 3: Rewrite `packages/cli/package.json` dependencies**

```json
{
	"name": "@pawl/cli",
	"module": "index.ts",
	"type": "module",
	"private": true,
	"engines": {
		"node": "24.x"
	},
	"scripts": {
		"dev": "eve dev",
		"build": "eve build",
		"start": "eve start",
		"typecheck": "tsc",
		"eval": "eve eval"
	},
	"devDependencies": {
		"@types/bun": "catalog:",
		"@types/node": "24.x"
	},
	"peerDependencies": {
		"typescript": "catalog:"
	},
	"dependencies": {
		"@ai-sdk/amazon-bedrock": "catalog:",
		"@aws-sdk/client-bedrock": "^3.1053.0",
		"@aws-sdk/client-sso-oidc": "^3.1053.0",
		"@aws-sdk/client-sts": "^3.1053.0",
		"@aws-sdk/credential-providers": "^3.1053.0",
		"@clack/prompts": "^1.4.0",
		"@pawl/cdk": "workspace:*",
		"@smithy/core": "^3.31.0",
		"ai": "catalog:",
		"beautiful-mermaid": "^1.1.3",
		"eve": "catalog:",
		"zod": "catalog:"
	}
}
```

`@flue/runtime`, `valibot`, and `@earendil-works/pi-coding-agent` are removed.

- [ ] **Step 4: Add the eve build-output ignores**

Create `packages/cli/.gitignore`:

```
.eve
.output
.nitro
.vercel
.env*.local
```

**Rationale:** the root `.gitignore` does not cover eve's generated directories, and `.eve/` holds compiled manifests, dev runtime snapshots, logs and traces that must never be committed.

- [ ] **Step 5: Install**

```bash
cd /Users/jolo/Development/pawl && bun install
```

Expected: resolves `eve@0.54.3`, `ai@7.0.99`, `@ai-sdk/amazon-bedrock@5.0.82`; no reference to the removed packages.

- [ ] **Step 6: Verify the eve CLI boots**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx eve --version
```

Expected: prints a version (or help). If the bin cannot run under Bun, fall back to `node node_modules/eve/bin/eve.js --version` and record which works.

- [ ] **Step 7: Verify the Bedrock provider pairs with `ai` v7**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx tsc --noEmit --types bun --moduleResolution bundler --module preserve --target esnext --skipLibCheck -e 'import { bedrock } from "@ai-sdk/amazon-bedrock"; import type { LanguageModel } from "ai"; const m: LanguageModel = bedrock("eu.anthropic.claude-sonnet-4-6");'
```

Expected: no type error. This pins that `bedrock()` returns the same `LanguageModel` type eve's `defineAgent` accepts.

- [ ] **Step 8: Commit**

```bash
cd /Users/jolo/Development/pawl && git add package.json packages/cli/package.json packages/cli/.gitignore bun.lock
git commit -m "chore(cli): swap pi-coding-agent and flue for eve"
```

---

## Task 1: Bedrock model catalog (`src/bedrock-models.ts`)

Replaces `getModels("amazon-bedrock")` from the undeclared `@earendil-works/pi-ai` import in `index.ts`. Uses the already-present `@aws-sdk/client-bedrock` dependency.

The old picker grouped foundation models by base id, stripping the `us.`/`eu.`/`global.` inference-profile prefix so the user chooses provider → model → scope. `ListFoundationModels` gives the base models; `ListInferenceProfiles` gives the available cross-region scopes. Group them the same way.

**Files:**
- Create: `packages/cli/src/bedrock-models.ts`
- Test: `packages/cli/tests/bedrock-models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { groupBedrockModels } from "../src/bedrock-models";

describe("groupBedrockModels", () => {
	test("groups a base model with its inference-profile scopes", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "anthropic.claude-sonnet-4-6",
					modelName: "Claude Sonnet 4.6",
					providerName: "Anthropic",
					inputModalities: ["TEXT"],
					outputModalities: ["TEXT"],
				},
			],
			[
				{ inferenceProfileId: "eu.anthropic.claude-sonnet-4-6" },
				{ inferenceProfileId: "us.anthropic.claude-sonnet-4-6" },
			],
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.baseId).toBe("anthropic.claude-sonnet-4-6");
		expect(groups[0]?.provider).toBe("anthropic");
		expect(groups[0]?.name).toBe("Claude Sonnet 4.6");
		expect([...(groups[0]?.scopes ?? [])].sort()).toEqual([
			"eu.anthropic.claude-sonnet-4-6",
			"us.anthropic.claude-sonnet-4-6",
		]);
	});

	test("falls back to the bare model id when no inference profile exists", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "amazon.nova-pro-v1:0",
					modelName: "Nova Pro",
					providerName: "Amazon",
					inputModalities: ["TEXT"],
					outputModalities: ["TEXT"],
				},
			],
			[],
		);

		expect(groups[0]?.scopes).toEqual(["amazon.nova-pro-v1:0"]);
	});

	test("keeps only text-output models", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "amazon.titan-embed-text-v2:0",
					modelName: "Titan Embed",
					providerName: "Amazon",
					inputModalities: ["TEXT"],
					outputModalities: ["EMBEDDING"],
				},
				{
					modelId: "anthropic.claude-opus-4-8",
					modelName: "Claude Opus 4.8",
					providerName: "Anthropic",
					inputModalities: ["TEXT"],
					outputModalities: ["TEXT"],
				},
			],
			[],
		);

		expect(groups.map((g) => g.baseId)).toEqual(["anthropic.claude-opus-4-8"]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/bedrock-models.test.ts
```

Expected: FAIL — `groupBedrockModels` is not exported.

- [ ] **Step 3: Implement the catalog module**

`packages/cli/src/bedrock-models.ts`:

```ts
import {
	BedrockClient,
	ListFoundationModelsCommand,
	ListInferenceProfilesCommand,
} from "@aws-sdk/client-bedrock";
import { fromIni } from "@aws-sdk/credential-providers";

/** Minimal shape the picker needs from a Bedrock foundation model. */
export interface FoundationModelLike {
	modelId?: string | undefined;
	modelName?: string | undefined;
	providerName?: string | undefined;
	outputModalities?: string[] | undefined;
}

/** Minimal shape the picker needs from a Bedrock inference profile. */
export interface InferenceProfileLike {
	inferenceProfileId?: string | undefined;
}

export interface BedrockModelGroup {
	/** Foundation model id without any inference-profile prefix. */
	baseId: string;
	/** Provider slug, e.g. `anthropic`. */
	provider: string;
	/** Human-readable model name. */
	name: string;
	/**
	 * Selectable model ids for this base model: every inference profile that
	 * targets it, or the bare base id when the model needs no profile.
	 */
	scopes: string[];
}

const SCOPES = ["us", "eu", "global", "apac"];

/** Strip a leading `<scope>.` inference-profile prefix, returning the scope. */
export function splitScope(modelId: string): { scope: string | null; baseId: string } {
	for (const scope of SCOPES) {
		const prefix = `${scope}.`;
		if (modelId.startsWith(prefix)) {
			return { scope, baseId: modelId.slice(prefix.length) };
		}
	}
	return { scope: null, baseId: modelId };
}

/**
 * Group foundation models with the inference profiles that expose them.
 * Text-output filtering matches what the launcher previously took from pi-ai.
 */
export function groupBedrockModels(
	models: FoundationModelLike[],
	profiles: InferenceProfileLike[],
): BedrockModelGroup[] {
	const scopesByBase = new Map<string, string[]>();
	for (const profile of profiles) {
		const id = profile.inferenceProfileId;
		if (!id) continue;
		const { baseId } = splitScope(id);
		const scopes = scopesByBase.get(baseId) ?? [];
		scopes.push(id);
		scopesByBase.set(baseId, scopes);
	}

	const groups: BedrockModelGroup[] = [];
	for (const model of models) {
		const baseId = model.modelId;
		if (!baseId) continue;
		const outputs = model.outputModalities ?? [];
		if (!outputs.includes("TEXT")) continue;
		const provider = baseId.split(".")[0] ?? "unknown";
		const scopes = scopesByBase.get(baseId);
		groups.push({
			baseId,
			provider,
			name: model.modelName ?? baseId,
			scopes: scopes && scopes.length > 0 ? scopes : [baseId],
		});
	}
	return groups.sort((a, b) => a.baseId.localeCompare(b.baseId));
}

/** Fetch and group the Bedrock catalog for a profile/region. */
export async function listBedrockModelGroups(
	profile: string,
	region: string,
): Promise<BedrockModelGroup[]> {
	const client = new BedrockClient({
		profile,
		region,
		credentials: fromIni({ profile }),
	});
	const [models, profiles] = await Promise.all([
		client.send(
			new ListFoundationModelsCommand({ byOutputModality: "TEXT" }),
		),
		client
			.send(new ListInferenceProfilesCommand({}))
			.catch(() => ({ inferenceProfileSummaries: [] })),
	]);
	return groupBedrockModels(
		models.modelSummaries ?? [],
		profiles.inferenceProfileSummaries ?? [],
	);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/bedrock-models.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/src/bedrock-models.ts packages/cli/tests/bedrock-models.test.ts
git commit -m "feat(cli): add native Bedrock model catalog"
```

---

## Task 2: Host exec + eve tools

**Files:**
- Create: `packages/cli/src/host-exec.ts`, `packages/cli/agent/tools/*.ts`
- Test: `packages/cli/tests/host-exec.test.ts`, `packages/cli/tests/agent-tools.test.ts`

- [ ] **Step 1: Write the failing host-exec test**

```ts
import { expect, test } from "bun:test";
import { createHostExec } from "../src/host-exec";

test("host exec returns stdout for a successful command", async () => {
	const exec = createHostExec("/tmp");
	const { stdout } = await exec("echo", ["hello"]);
	expect(stdout.trim()).toBe("hello");
});

test("host exec rejects on a nonzero exit", async () => {
	const exec = createHostExec("/tmp");
	await expect(exec("cat", ["/definitely/missing"])).rejects.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/host-exec.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/host-exec.ts`**

`PawlHarness` takes an `ExecFn` and falls back to a throwing stub. eve tools run in the app runtime, so the host is the right place to run `find`/`cat`/`head` against the user's project.

```ts
import { $ } from "bun";
import type { ExecFn } from "./harness";

/**
 * Build an {@link ExecFn} that runs commands on the host in `cwd`.
 *
 * Authored eve tools run in the app runtime — not the sandbox — so a
 * PawlHarness constructed inside a tool operates on the user's real project
 * directory. Commands that exit nonzero reject; PawlHarness already treats a
 * rejection as "file absent / directory unreadable".
 */
export function createHostExec(cwd: string): ExecFn {
	return async (cmd, args) => {
		const proc = Bun.spawn([cmd, ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`${cmd} exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`,
			);
		}
		return { stdout };
	};
}

/** PawlHarness instance bound to the host working directory. */
export function createHostHarness(cwd = process.cwd()) {
	return { cwd, exec: createHostExec(cwd) };
}

export { $ };
```

> Note: drop the trailing `export { $ }` if `$` is unused; it is included only to keep the Bun import exercised. Prefer removing the import entirely if nothing else needs it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/host-exec.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tool tests**

```ts
import { describe, expect, test } from "bun:test";
import { createHostExec } from "../src/host-exec";
import { PawlHarness } from "../src/harness";
import costTool from "../agent/tools/cost";
import architectureTool from "../agent/tools/architecture";

describe("agent tools", () => {
	test("cost returns the cost-optimization prompt", async () => {
		const result = await costTool.execute({}, {} as never);
		expect(String(result)).toContain("cost optimization");
	});

	test("architecture renders the plan diagram", async () => {
		const result = await architectureTool.execute({}, {} as never);
		expect(String(result)).toContain("No .pawl/plan.md");
	});
});

describe("harness wiring", () => {
	test("host exec drives PawlHarness scanCodebase", async () => {
		const harness = new PawlHarness({ cwd: process.cwd(), exec: createHostExec(process.cwd()) });
		const scan = await harness.scanCodebase();
		expect(scan).toContain("package.json");
	});
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/agent-tools.test.ts
```

Expected: FAIL — tool modules do not exist.

- [ ] **Step 7: Create the tools**

`packages/cli/agent/tools/plan.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { PawlHarness } from "../../src/harness";
import { createHostExec } from "../../src/host-exec";

export default defineTool({
	description:
		"Analyze the current project and produce an AWS infrastructure plan. This is the first phase of the pawl workflow: always call it before generating infrastructure code, and wait for the user to approve the plan before calling generate.",
	inputSchema: z.object({
		notes: z.string().optional().describe("Extra requirements from the user."),
	}),
	async execute({ notes }) {
		const cwd = process.cwd();
		const harness = new PawlHarness({ cwd, exec: createHostExec(cwd) });
		return harness.commands.plan(notes);
	},
});
```

`packages/cli/agent/tools/generate.ts`:

```ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { PawlHarness } from "../../src/harness";
import { createHostExec } from "../../src/host-exec";

export default defineTool({
	description:
		"Generate CDK infrastructure code from the approved .pawl/plan.md. Only call this after the user has approved the plan.",
	inputSchema: z.object({}),
	// Writing infrastructure files is the point of no return in the pawl
	// workflow, so it always needs an explicit human decision.
	approval: always(),
	async execute() {
		const cwd = process.cwd();
		const harness = new PawlHarness({ cwd, exec: createHostExec(cwd) });
		return harness.commands.generate();
	},
});
```

`packages/cli/agent/tools/well_architected.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { PawlHarness } from "../../src/harness";
import { createHostExec } from "../../src/host-exec";

export default defineTool({
	description:
		"Run an AWS Well-Architected Framework review of the current project across all six pillars.",
	inputSchema: z.object({}),
	async execute() {
		const cwd = process.cwd();
		const harness = new PawlHarness({ cwd, exec: createHostExec(cwd) });
		return harness.commands.wellArchitected();
	},
});
```

`packages/cli/agent/tools/cost.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { PawlHarness } from "../../src/harness";
import { createHostExec } from "../../src/host-exec";

export default defineTool({
	description:
		"Analyze the current project for AWS cost-optimization opportunities and return concrete recommendations.",
	inputSchema: z.object({}),
	async execute() {
		const cwd = process.cwd();
		const harness = new PawlHarness({ cwd, exec: createHostExec(cwd) });
		return harness.commands.cost();
	},
});
```

`packages/cli/agent/tools/architecture.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { renderPlanDiagram } from "../../src/diagram";
import { createHostExec } from "../../src/host-exec";

export default defineTool({
	description:
		"Render the Mermaid architecture diagram from .pawl/plan.md as ASCII art for the terminal.",
	inputSchema: z.object({}),
	async execute() {
		const cwd = process.cwd();
		return renderPlanDiagram(cwd, createHostExec(cwd));
	},
});
```

`packages/cli/agent/tools/init_project.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	installScaffoldDependencies,
	runPawlInit,
	writeScaffoldProject,
} from "../../src/scaffold";

export default defineTool({
	description:
		"Scaffold a new pawl project (CDK app, infra directory, config files) in the current directory.",
	inputSchema: z.object({
		name: z.string().optional().describe("Project name; prompted when omitted."),
		install: z.boolean().optional().describe("Install dependencies after writing files."),
	}),
	async execute({ name, install }) {
		const cwd = process.cwd();
		const config = await runPawlInit({
			cwd,
			overrides: { projectName: name, installNow: install },
		});
		const written = await writeScaffoldProject(config);
		if (config.installNow) {
			await installScaffoldDependencies(config);
		}
		return {
			projectDir: config.projectDir,
			files: written.length,
		};
	},
});
```

- [ ] **Step 8: Run the tool tests**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/agent-tools.test.ts
```

Expected: PASS. If a tool's `execute` signature differs from `(input, ctx)`, adapt the test's second argument; the important assertion is the returned text.

- [ ] **Step 9: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/src/host-exec.ts packages/cli/agent/tools packages/cli/tests/host-exec.test.ts packages/cli/tests/agent-tools.test.ts
git commit -m "feat(cli): add host exec and eve tools for the pawl workflows"
```

---

## Task 3: Agent config, instructions, and channel

**Files:**
- Create: `packages/cli/agent/agent.ts`, `packages/cli/agent/instructions.md`, `packages/cli/agent/channels/eve.ts`
- Test: `packages/cli/tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing config test**

```ts
import { expect, test } from "bun:test";
import path from "node:path";

const agentDir = path.join(import.meta.dir, "../agent");

test("agent.ts wires the Bedrock model with an explicit context window", async () => {
	const source = await Bun.file(path.join(agentDir, "agent.ts")).text();
	expect(source).toContain("@ai-sdk/amazon-bedrock");
	expect(source).toContain("modelContextWindowTokens");
});

test("instructions carry the AWS scope guard and the two-phase workflow", async () => {
	const instructions = await Bun.file(
		path.join(agentDir, "instructions.md"),
	).text();
	expect(instructions).toContain("Sorry, I cannot help you here");
	expect(instructions).toContain(".pawl/plan.md");
});

test("no authored eve file imports a removed dependency", async () => {
	const result = await Bun.$`grep -rIl "pi-coding-agent\\|@flue/runtime" agent src index.ts`.quiet().nothrow();
	expect(result.exitCode).not.toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/agent-config.test.ts
```

Expected: FAIL — `agent/agent.ts` not found.

- [ ] **Step 3: Author `agent/agent.ts`**

```ts
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";

/**
 * pawl runs on AWS Bedrock, so the model is a direct AI SDK provider instance
 * rather than an AI Gateway id. The launcher resolves PAWL_BEDROCK_MODEL from
 * the interactive picker and passes it through the environment; the fallback
 * keeps `eve dev` usable without the launcher.
 *
 * Bedrock models are not in the AI Gateway catalog, so eve cannot look the
 * context window up. Set it explicitly.
 */
export default defineAgent({
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? "eu.anthropic.claude-sonnet-4-6"),
	modelContextWindowTokens: 200_000,
	reasoning: "medium",
});
```

- [ ] **Step 4: Author `agent/instructions.md`**

```markdown
# Identity

You are pawl, an AWS infrastructure assistant. You help users plan, generate, review, and optimize AWS infrastructure using CDK, always preferring the `@pawl/cdk` constructs and `@pawl/lambda` handlers that are available in this workspace.

# Scope

ONLY answer questions about pawl, AWS, cloud infrastructure, CDK, Lambda, or related DevOps topics.

If the user asks about unrelated topics (personal questions, general knowledge, other programming topics not related to AWS, etc.), respond with exactly:

> Sorry, I cannot help you here. But I can help you with AWS related questions.

Do not elaborate beyond this message.

# Workflow

Always generate an infrastructure plan FIRST when asked to deploy, architect, or build infrastructure:

1. Call the `plan` tool to analyze the codebase and draft the plan.
2. Show the plan and ask the user to approve it. Store it at `.pawl/plan.md`.
3. Only after the user approves the plan, call the `generate` tool to write infrastructure code.

If the user asks you to generate code before a plan exists, create the plan first and ask for approval. Never skip the plan.

# Conventions

- Use `@pawl/cdk` constructs exclusively; never use raw `aws-cdk-lib` in generated application code.
- Use `@pawl/lambda` handler wrappers for every Lambda function.
- Include least-privilege IAM, CloudWatch alarms, and X-Ray tracing in every design.
- Include a Mermaid `graph TD` architecture diagram in every plan.
```

- [ ] **Step 5: Author `agent/channels/eve.ts`**

```ts
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * The built-in eve HTTP channel replaces the Flue `/agents/*` endpoints.
 * Sessions are created with `POST /eve/v1/session` and continued with
 * `POST /eve/v1/session/:id`.
 */
export default eveChannel({
	auth: [vercelOidc(), localDev(), placeholderAuth()],
});
```

- [ ] **Step 6: Run the config test**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/agent-config.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Verify eve discovers the surface**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx eve info
```

Expected: lists the instructions, `agent/tools/*`, skills, subagents and channel with no severity-error diagnostics. Fix any discovery error before continuing.

- [ ] **Step 8: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/agent/agent.ts packages/cli/agent/instructions.md packages/cli/agent/channels packages/cli/tests/agent-config.test.ts
git commit -m "feat(cli): author the eve root agent"
```

---

## Task 4: Move skills under `agent/`

**Files:**
- Move: `packages/cli/skills/*` → `packages/cli/agent/skills/*`
- Modify: `packages/cli/tests/skills.test.ts`

- [ ] **Step 1: Update the test path first (red)**

In `packages/cli/tests/skills.test.ts`, change:

```ts
path.join(import.meta.dir, "../skills/pawl-plan/SKILL.md"),
```

to:

```ts
path.join(import.meta.dir, "../agent/skills/pawl-plan/SKILL.md"),
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/skills.test.ts
```

Expected: FAIL — file not found at the new path.

- [ ] **Step 3: Move the skills**

```bash
cd /Users/jolo/Development/pawl/packages/cli && mkdir -p agent/skills && git mv skills/pawl-plan agent/skills/pawl-plan && git mv skills/pawl-codegen agent/skills/pawl-codegen && git mv skills/pawl-constructs agent/skills/pawl-constructs && rmdir skills
```

- [ ] **Step 4: Confirm each packaged skill has `description` frontmatter**

```bash
cd /Users/jolo/Development/pawl/packages/cli && head -4 agent/skills/*/SKILL.md
```

Expected: every `SKILL.md` starts with a frontmatter block containing `description:`. eve requires it for packaged (directory) skills.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/skills.test.ts && bunx eve info
```

Expected: PASS, and `eve info` lists three skills.

- [ ] **Step 6: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/agent/skills packages/cli/skills packages/cli/tests/skills.test.ts
git commit -m "refactor(cli): move skills under agent/ for eve discovery"
```

---

## Task 5: Subagents replacing the Flue agents

The Flue agents were separate HTTP workflows. Their eve equivalent is declared subagents — specialists the root delegates to — plus the built-in HTTP session API. This preserves the plan/generate/well-architected separation without inventing webhook plumbing.

**Files:**
- Create: `packages/cli/agent/subagents/planner/*`, `.../generator/*`, `.../well-architected/*`

- [ ] **Step 1: Write a discovery test (red)**

Append to `packages/cli/tests/agent-config.test.ts`:

```ts
test("each declared subagent has a description and an agent config", async () => {
	const ids = ["planner", "generator", "well-architected"];
	for (const id of ids) {
		const source = await Bun.file(
			path.join(agentDir, "subagents", id, "agent.ts"),
		).text();
		expect(source).toContain("description:");
		expect(source).toContain("defineAgent");
	}
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/agent-config.test.ts
```

Expected: FAIL — subagent files do not exist.

- [ ] **Step 3: Create the subagents**

`packages/cli/agent/subagents/planner/agent.ts`:

```ts
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";
import { z } from "zod";

export default defineAgent({
	description:
		"Turn a codebase scan and user notes into a structured AWS infrastructure plan.",
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? "eu.anthropic.claude-sonnet-4-6"),
	modelContextWindowTokens: 200_000,
	outputSchema: z.object({
		summary: z.string(),
		services: z.array(z.object({ name: z.string(), justification: z.string() })),
		network: z.string(),
		security: z.string(),
		observability: z.string(),
		diagram: z.string(),
		deployment: z.string(),
		filePlan: z.array(z.object({ path: z.string(), purpose: z.string() })),
	}),
});
```

`packages/cli/agent/subagents/planner/instructions.md`:

```markdown
You are the planning specialist for pawl.

Given a codebase scan and optional user notes, produce an AWS infrastructure plan for this project.

- Identify runtime, framework, dependencies, and deployment hints from the scan.
- Propose AWS services with a one-line justification each.
- Decide on VPC, subnets, and NAT only when the workload requires them.
- Specify least-privilege IAM, encryption, secrets handling, and network controls.
- Specify CloudWatch alarms, X-Ray tracing, and structured JSON logging.
- Always include a Mermaid `graph TD` architecture diagram with AWS-style labels.
- Prefer `@pawl/cdk` constructs and `@pawl/lambda` handlers in the file plan.
- Prefer serverless over provisioned resources unless justified.

Return the structured plan. Wait for approval before any code generation happens.
```

`packages/cli/agent/subagents/generator/agent.ts`:

```ts
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";

export default defineAgent({
	description:
		"Generate CDK infrastructure code from an approved pawl plan.",
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? "eu.anthropic.claude-sonnet-4-6"),
	modelContextWindowTokens: 200_000,
});
```

`packages/cli/agent/subagents/generator/instructions.md`:

```markdown
You are the generation specialist for pawl.

Read the approved plan at `.pawl/plan.md` and write the CDK infrastructure code it describes.

- Use `@pawl/cdk` constructs exclusively; never import `aws-cdk-lib` directly in application code.
- Use `@pawl/lambda` handler wrappers for every Lambda function.
- Write to `infra/`: CDK stacks, Lambda handlers, `package.json`, `tsconfig.json`, and `cdk.json`.
- Include least-privilege IAM, alarms, and tracing exactly as the plan specifies.
- Run `npx cdk synth` and fix any synthesis errors before reporting completion.
```

`packages/cli/agent/subagents/well-architected/agent.ts`:

```ts
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";
import { z } from "zod";

export default defineAgent({
	description:
		"Review a project against the six AWS Well-Architected pillars and report risks.",
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? "eu.anthropic.claude-sonnet-4-6"),
	modelContextWindowTokens: 200_000,
	outputSchema: z.object({
		pillars: z.array(
			z.object({
				pillar: z.string(),
				currentState: z.string(),
				risks: z.array(z.string()),
				recommendations: z.array(
					z.object({
						text: z.string(),
						priority: z.enum(["high", "medium", "low"]),
					}),
				),
			}),
		),
	}),
});
```

`packages/cli/agent/subagents/well-architected/instructions.md`:

```markdown
You are the Well-Architected review specialist for pawl.

Review the project against all six pillars: Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, and Sustainability.

If infrastructure code (CDK/CloudFormation/Terraform) exists, review it directly. Otherwise analyze the codebase and assess the implied architecture.

For each pillar report the current state, the risks you identified, and specific recommendations with a priority of high, medium, or low. Cite the file or resource behind every risk.
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/agent-config.test.ts && bunx eve info
```

Expected: PASS, and `eve info` lists three subagents with no diagnostics.

- [ ] **Step 5: Delete the Flue agents**

```bash
cd /Users/jolo/Development/pawl/packages/cli && git rm -r agents
```

- [ ] **Step 6: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/agent/subagents packages/cli/agents packages/cli/tests/agent-config.test.ts
git commit -m "feat(cli): replace flue agents with eve subagents"
```

---

## Task 6: Launcher (`index.ts`) and removal of pi-specific modules

**Files:**
- Modify: `packages/cli/index.ts`
- Create: `packages/cli/src/launch.ts`
- Delete: `packages/cli/src/infra-agent.ts`, `packages/cli/src/commands.ts`, `packages/cli/src/aws-guard.ts`
- Test: `packages/cli/tests/launch.test.ts`

- [ ] **Step 1: Write the failing launcher test**

```ts
import { describe, expect, test } from "bun:test";
import { buildEveEnv, eveDevCommand } from "../src/launch";

describe("launch", () => {
	test("buildEveEnv carries the resolved AWS settings", () => {
		const env = buildEveEnv({
			profile: "prod",
			region: "eu-central-1",
			modelId: "eu.anthropic.claude-sonnet-4-6",
			base: { PATH: "/bin" },
		});
		expect(env.AWS_PROFILE).toBe("prod");
		expect(env.AWS_REGION).toBe("eu-central-1");
		expect(env.PAWL_BEDROCK_MODEL).toBe("eu.anthropic.claude-sonnet-4-6");
		expect(env.PATH).toBe("/bin");
	});

	test("eveDevCommand resolves the workspace binary", () => {
		expect(eveDevCommand()).toEqual(["eve", "dev"]);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/launch.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/launch.ts`**

```ts
/** Build the child-process environment for `eve dev`. */
export function buildEveEnv(options: {
	profile: string;
	region: string;
	modelId: string;
	base?: Record<string, string | undefined>;
}): Record<string, string | undefined> {
	return {
		...options.base,
		AWS_PROFILE: options.profile,
		AWS_REGION: options.region,
		PAWL_BEDROCK_MODEL: options.modelId,
	};
}

/** Command used to hand off to eve's terminal UI. */
export function eveDevCommand(): [string, string] {
	return ["eve", "dev"];
}

/**
 * Start `eve dev` with inherited stdio so the eve terminal UI owns the
 * terminal. Resolves with the child's exit code.
 */
export async function launchEveDev(options: {
	profile: string;
	region: string;
	modelId: string;
	cwd?: string;
}): Promise<number> {
	const [cmd, ...args] = eveDevCommand();
	const proc = Bun.spawn([cmd, ...args], {
		cwd: options.cwd ?? process.cwd(),
		env: buildEveEnv({
			profile: options.profile,
			region: options.region,
			modelId: options.modelId,
			base: process.env,
		}),
		stdio: ["inherit", "inherit", "inherit"],
	});
	return proc.exited;
}
```

- [ ] **Step 4: Run the launcher test**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/launch.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Rewrite `index.ts`**

Keep the subcommand dispatch (`init`, `init codecommit`, `init codepipeline`) and the AWS profile/credential/region/Bedrock-access pre-flight exactly as they are. Replace the pi-ai model-block with a catalog-driven picker and swap `startAgent` for `launchEveDev`.

Key changes:
1. Delete `import { getModels } from "@earendil-works/pi-ai";` and the whole `allModels`/`groups`/`Scope`/inference-prefix-patching block.
2. Import `listBedrockModelGroups` and `launchEveDev`.
3. Build the provider → model → scope menus from `BedrockModelGroup[]`.
4. Do **not** mutate the catalog with a region prefix; each group's `scopes` are already concrete, selectable ids. Use the selected scope id as `modelId`.
5. Replace the final `await startAgent(model, message)` with:

```ts
const exitCode = await launchEveDev({
	profile,
	region,
	modelId,
});
process.exit(exitCode);
```

The `outro(...)` message becomes:

```ts
outro(
	`Starting eve — profile: ${profile} | region: ${region} | model: ${modelId}`,
);
```

- [ ] **Step 6: Delete the pi-specific modules**

```bash
cd /Users/jolo/Development/pawl/packages/cli && git rm src/infra-agent.ts src/commands.ts src/aws-guard.ts
```

- [ ] **Step 7: Update `tsconfig.json`**

```json
{
	"compilerOptions": {
		"lib": ["ESNext"],
		"target": "ESNext",
		"module": "Preserve",
		"moduleDetection": "force",
		"jsx": "react-jsx",
		"allowJs": true,
		"moduleResolution": "bundler",
		"allowImportingTsExtensions": true,
		"verbatimModuleSyntax": true,
		"noEmit": true,
		"types": ["node", "eve/workflow-modules"],
		"strict": true,
		"skipLibCheck": true,
		"noFallthroughCasesInSwitch": true,
		"noUncheckedIndexedAccess": true,
		"noImplicitOverride": true,
		"noUnusedLocals": false,
		"noUnusedParameters": false,
		"noPropertyAccessFromIndexSignature": false
	},
	"include": ["agent/**/*.ts", "src/**/*.ts", "index.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 8: Typecheck**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx tsc --noEmit
```

Expected: no errors. Fix any real type errors; do not silence with `any`.

- [ ] **Step 9: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/index.ts packages/cli/src/launch.ts packages/cli/tsconfig.json packages/cli/tests/launch.test.ts packages/cli/src/infra-agent.ts packages/cli/src/commands.ts packages/cli/src/aws-guard.ts
git commit -m "feat(cli): hand off from the AWS pre-flight to eve dev"
```

---

## Task 7: Documentation

**Files:**
- Modify: `packages/cli/README.md`, `AGENTS.md` (root)

- [ ] **Step 1: Rewrite the README architecture and usage sections**

Replace the two-layer list with:

```markdown
## Architecture

pawl CLI is built in two layers:

1. **`PawlHarness`** — Runtime-agnostic core handling codebase scanning and prompt construction (`src/harness.ts`). Use it to integrate pawl with any agent framework.
2. **eve agent** — The `agent/` directory is an [eve](https://eve.dev) app: instructions, tools, skills, subagents, and the HTTP channel. `eve dev` serves the terminal UI; `eve build`/`eve start` serve the durable HTTP runtime.
```

Replace the "Flue Agents (HTTP API)" section with an "eve HTTP API" section documenting the session route:

```bash
eve dev --no-ui
curl -X POST http://localhost:2000/eve/v1/session \
  -H "Content-Type: application/json" \
  -d '{"message": "Plan infrastructure for this project"}'
```

Add a note that interactive commands are now model-invoked tools (`plan`, `generate`, `well_architected`, `cost`, `architecture`, `init_project`) rather than slash commands, and that `generate` requires approval.

- [ ] **Step 2: Update the root `AGENTS.md`**

Change the CLI bullet in the project-structure block from `# AI-powered infrastructure CLI (Bedrock + pi-coding-agent)` to `# AI-powered infrastructure CLI (Bedrock + eve)`, and add to the Stack section: `Agent framework: eve (packages/cli/agent)`. Document the Node 24 requirement for the CLI.

- [ ] **Step 3: Verify no stale references remain**

```bash
cd /Users/jolo/Development/pawl && grep -rn "pi-coding-agent\|@flue\|Flue" packages/cli README.md AGENTS.md docs/src 2>/dev/null | grep -v node_modules
```

Expected: no matches (historical plan documents under `docs/superpowers/plans/` are exempt).

- [ ] **Step 4: Commit**

```bash
cd /Users/jolo/Development/pawl && git add packages/cli/README.md AGENTS.md
git commit -m "docs: describe the eve-based pawl CLI"
```

---

## Task 8: Full verification

- [ ] **Step 1: Lint**

```bash
cd /Users/jolo/Development/pawl && bunx biome check packages/cli
```

Expected: zero errors.

- [ ] **Step 2: Tests**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test
```

Expected: the pre-existing 146 tests plus the new tests, zero failures.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: eve discovery**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx eve info
```

Expected: no severity-error diagnostics.

- [ ] **Step 5: eve build**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx eve build
```

Expected: builds and prints the output directory. If it fails for a reason unrelated to this migration (e.g. Nitro/Node version in the workspace), record the failure category rather than papering over it.

- [ ] **Step 6: Smoke-test the dev server headlessly**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bunx eve dev --no-ui &
# wait for the listening URL, then:
curl -sS -X POST http://localhost:2000/eve/v1/session -H "Content-Type: application/json" -d '{"message":"hi"}' | head -c 400
kill %1
```

Expected: a session id or a structured error. A model-auth error is acceptable evidence that the runtime boots; a boot failure is not.

- [ ] **Step 7: Frozen install**

```bash
cd /Users/jolo/Development/pawl && bun install --frozen-lockfile
```

Expected: succeeds.

- [ ] **Step 8: Commit any verification fixes**

```bash
cd /Users/jolo/Development/pawl && git add -A && git commit -m "test(cli): verify the eve migration end to end"
```

---

## Risks and open items

| Risk | Handling |
| --- | --- |
| `@ai-sdk/amazon-bedrock` 5.x may not pair with `ai` v7 | Pinned by Task 0 Step 7. If it fails, check the package's `ai-v6`/`ai-v7` dist-tags and pin the matching pair. |
| eve may reject authored imports that reach `../../src/` | Task 3 Step 7 (`eve info`) surfaces this. Fallback: move `harness.ts` and friends under `agent/lib/` and re-export from `src/`. |
| `eve dev` launcher spawn needs `eve` on `PATH` | `bunx eve dev` in a workspace resolves the local binary. If not, resolve `node_modules/.bin/eve` explicitly in `eveDevCommand()`. |
| Losing slash commands is a UX change | Documented; model-invoked tools plus `generate` approval are the eve-idiomatic replacement. |
| `eve build` under Bun/Nitro in this monorepo | Task 8 Step 5 records the failure category instead of hiding it. |
| Dropping Flue's per-agent webhook endpoints | Replaced by eve's session HTTP API; documented in the README. |
| Node 24 requirement is now package-local | `packages/cli/package.json#engines`, root `AGENTS.md`, and `agent/skills/pawl-plan` (already says Node 24). |
