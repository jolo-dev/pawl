# CLI Harness Extraction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `@pawl/cli`'s AWS credential handling, codebase scanning, prompt construction, and workflow commands into a runtime-agnostic `PawlHarness` class, so the same logic works with both the Pi TUI and Flue (or any agent harness).

**Architecture:** Extract pi-coding-agent-specific code (`ExtensionFactory`, `InteractiveMode`, `ctx.sendUserMessage`) into thin wrappers around a new `PawlHarness` class. The harness has no LLM dependency — it exposes `scanCodebase()`, prompt builders, and loads skill/prompt markdown files. Both the Pi CLI and future Flue agents consume the same harness.

**Tech Stack:** Bun, TypeScript, AWS SDK (already in use), `@earendil-works/pi-coding-agent` (kept as TUI dependency), `@flue/runtime` (new — for Flue agents)

**Target file layout after refactor:**

```
packages/cli/
├── src/
│   ├── harness.ts                  # NEW — PawlHarness class (runtime-agnostic)
│   ├── commands.ts                 # MODIFIED — thin ExtensionFactory, delegates to PawlHarness
│   ├── aws-credentials.ts          # UNCHANGED — already runtime-agnostic
│   ├── aws-guard.ts                # UNCHANGED — pi-specific system prompt guard
│   └── infra-agent.ts              # UNCHANGED — pi-specific session wrapper
├── prompts/                        # NEW — moved from .pi/prompts/
│   ├── infra.md
│   ├── well-architected.md
│   └── cost.md
├── skills/                         # UNCHANGED
│   ├── pawl-constructs/SKILL.md
│   ├── pawl-plan/SKILL.md
│   └── pawl-codegen/SKILL.md
├── agents/                         # NEW — Flue agent definitions
│   ├── plan.ts
│   ├── generate.ts
│   └── well-architected.ts
├── index.ts                        # MODIFIED — uses PawlHarness for scan + prompts
├── package.json                    # MODIFIED — add @flue/runtime, reorganize
├── README.md                       # MODIFIED — document harness + TUI + Flue usage
└── tests/
    ├── aws-credentials.test.ts     # UNCHANGED
    └── harness.test.ts             # NEW — harness unit tests
```

---

### Task 1: Create `src/harness.ts` — the runtime-agnostic core

**Files:**
- Create: `packages/cli/src/harness.ts`
- Create: `packages/cli/tests/harness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/harness.test.ts` with tests for the core harness:

```typescript
import { describe, expect, test } from "bun:test";
import { PawlHarness } from "../src/harness";

describe("PawlHarness", () => {
  test("scanCodebase returns structured markdown", async () => {
    const harness = new PawlHarness({
      cwd: process.cwd(),
      exec: async (cmd, args) => {
        // mock: simulate find output
        if (cmd === "find" && args.includes("-maxdepth")) {
          return { stdout: "/pawl/package.json\n/pawl/index.ts" };
        }
        if (cmd === "cat") {
          return { stdout: '{"name":"test","version":"1.0.0"}' };
        }
        return { stdout: "" };
      },
    });
    const result = await harness.scanCodebase();
    expect(result).toContain("## Project Structure");
    expect(result).toContain("## package.json");
  });

  test("loadPrompt loads markdown from prompts directory", async () => {
    const harness = new PawlHarness({
      promptsDir: new URL("../prompts", import.meta.url).pathname,
    });
    const infra = await harness.loadPrompt("infra");
    expect(infra).toContain("Generate AWS CDK infrastructure");
  });

  test("commands.plan constructs planning prompt with codebase scan", async () => {
    const harness = new PawlHarness({
      cwd: process.cwd(),
      exec: async () => ({ stdout: "" }),
      promptsDir: new URL("../prompts", import.meta.url).pathname,
    });
    const prompt = await harness.commands.plan("Use RDS");
    expect(prompt).toContain("Use RDS");
    expect(prompt).toContain("## Project Structure");
  });

  test("commands.generate returns generation prompt", async () => {
    const harness = new PawlHarness({
      promptsDir: new URL("../prompts", import.meta.url).pathname,
    });
    const prompt = await harness.commands.generate();
    expect(prompt).toContain(".pawl/plan.md");
    expect(prompt).toContain("@pawl/cdk");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cli && bun test tests/harness.test.ts
```
Expected: FAIL — `Cannot find module '../src/harness'`

- [ ] **Step 3: Write the PawlHarness implementation**

Create `packages/cli/src/harness.ts`:

```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPTS_DIR = resolve(__dirname, "..", "prompts");

export interface ExecFn {
  (cmd: string, args: string[]): Promise<{ stdout: string }>;
}

export interface PawlHarnessOptions {
  cwd?: string;
  exec?: ExecFn;
  promptsDir?: string;
}

/** Runtime-agnostic core for pawl CLI operations. */
export class PawlHarness {
  private cwd: string;
  private exec: ExecFn;
  private promptsDir: string;

  constructor(options: PawlHarnessOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.exec = options.exec ?? this.defaultExec;
    this.promptsDir = options.promptsDir ?? DEFAULT_PROMPTS_DIR;
  }

  /** Scan the codebase and return a structured markdown summary. */
  async scanCodebase(): Promise<string> {
    const results: string[] = [];

    // Directory structure
    try {
      const { stdout } = await this.exec("find", [
        this.cwd, "-maxdepth", "3",
        "-not", "-path", "*/node_modules/*",
        "-not", "-path", "*/.git/*",
        "-not", "-path", "*/dist/*",
        "-not", "-path", "*/cdk.out/*",
        "-type", "f",
      ]);
      const files = stdout.split("\n").filter(Boolean).slice(0, 50);
      results.push(`## Project Structure\n\`\`\`text\n${files.join("\n")}\n\`\`\``);
    } catch {
      results.push("## Project Structure\nCould not list files.");
    }

    // Key dependency files
    for (const file of [
      "package.json", "requirements.txt", "go.mod",
      "Gemfile", "pom.xml", "Dockerfile", "docker-compose.yml",
    ]) {
      try {
        const { stdout } = await this.exec("cat", [`${this.cwd}/${file}`]);
        results.push(`## ${file}\n\`\`\`\n${stdout.trim()}\n\`\`\``);
      } catch {
        // File doesn't exist, skip
      }
    }

    // Source files (first 5 non-test, non-config files)
    try {
      const { stdout } = await this.exec("find", [
        this.cwd, "-maxdepth", "3",
        "-not", "-path", "*/node_modules/*",
        "-not", "-path", "*/.git/*",
        "-not", "-path", "*/dist/*",
        "-not", "-path", "*/cdk.out/*",
        "-not", "-path", "*/test/*",
        "-not", "-path", "*/tests/*",
        "-not", "-path", "*/__snapshots__/*",
        "-name", "*.ts", "-o", "-name", "*.js",
        "-name", "*.py", "-o", "-name", "*.go",
      ]);
      const srcFiles = stdout.split("\n").filter(Boolean).slice(0, 5);
      for (const file of srcFiles) {
        try {
          const { stdout: content } = await this.exec("head", ["-50", file]);
          results.push(`## ${file}\n\`\`\`\n${content.trim()}\n\`\`\``);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return results.join("\n\n");
  }

  /** Load a prompt markdown file by name (without .md extension). */
  async loadPrompt(name: string): Promise<string> {
    const { stdout } = await this.exec("cat", [`${this.promptsDir}/${name}.md`]);
    // Strip YAML frontmatter — remove everything between --- at start and next ---
    return stdout.replace(/^---[\s\S]*?---\n?/, "");
  }

  /** Prompt constructors for each workflow command. */
  commands = {
    plan: async (userNotes?: string): Promise<string> => {
      const scanResult = await this.scanCodebase();
      return `Generate an AWS infrastructure plan for this project.

${userNotes ? `User notes: ${userNotes}\n\n` : ""}${scanResult}

Create a structured plan at .pawl/plan.md that covers:
1. Application summary (runtime, framework, type)
2. Proposed architecture (services, network, security, observability)
3. Deployment strategy
4. File plan

Wait for my review before generating any code.`;
    },

    generate: async (): Promise<string> => {
      return (
        "Read the approved infrastructure plan at .pawl/plan.md and generate the CDK infrastructure code. " +
        "Use @pawl/cdk constructs and @pawl/lambda handlers. " +
        "Write all files to the infra/ directory. " +
        "Include CDK stacks, Lambda handlers, package.json, tsconfig.json, and cdk.json."
      );
    },

    wellArchitected: async (): Promise<string> => {
      const prompt = await this.loadPrompt("well-architected");
      return prompt;
    },

    cost: async (): Promise<string> => {
      const prompt = await this.loadPrompt("cost");
      return prompt;
    },
  };

  private defaultExec: ExecFn = async () => {
    throw new Error(
      "PawlHarness: no exec function provided. Pass exec in options or use with a runtime that provides shell access.",
    );
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && bun test tests/harness.test.ts
```
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/harness.ts packages/cli/tests/harness.test.ts
git commit -m "feat(cli): add PawlHarness runtime-agnostic core"
```

---

### Task 2: Move prompts from `.pi/prompts/` to `prompts/`

**Files:**
- Create: `packages/cli/prompts/infra.md`
- Create: `packages/cli/prompts/well-architected.md`
- Create: `packages/cli/prompts/cost.md`
- Delete: `packages/cli/.pi/prompts/infra.md`
- Delete: `packages/cli/.pi/prompts/well-architected.md`
- Delete: `packages/cli/.pi/prompts/cost.md`

- [ ] **Step 1: Move prompt files**

Move each file from `.pi/prompts/` to `prompts/` at the package root. Strip the pi-specific `$@` suffix from each file (it's pi's context-injection marker, not needed by the harness).

`packages/cli/prompts/infra.md`:
```markdown
---
description: Generate AWS CDK infrastructure from the codebase
---
Analyze the current codebase and generate AWS CDK infrastructure code (TypeScript) to deploy it. Follow these steps:

1. Read the project structure and identify what services are needed (compute, storage, networking, databases, etc.)
2. Determine the appropriate AWS services for each component
3. Use read_file on ../../../cdk/ and ../../../lambda/ to check if these AWS CDK Constructs and Lambda Handler can be used here 
4. Generate based on 3. CDK code in TypeScript.
5. Include proper IAM roles with least-privilege permissions
6. Follow AWS Well-Architected best practices for the infrastructure design

Target region: use the AWS_REGION environment variable.
```

`packages/cli/prompts/well-architected.md`:
```markdown
---
description: AWS Well-Architected Framework review
---
Perform an AWS Well-Architected Framework review of this project. If infrastructure code (CDK/CloudFormation/Terraform) exists, review it directly. Otherwise, analyze the codebase and assess the implied architecture.

Evaluate against all six pillars:
1. **Operational Excellence** — monitoring, deployment, incident response
2. **Security** — IAM, encryption, network security, data protection
3. **Reliability** — fault tolerance, recovery, scaling
4. **Performance Efficiency** — resource selection, monitoring, trade-offs
5. **Cost Optimization** — cost-aware design, resource management
6. **Sustainability** — environmental impact, resource efficiency

For each pillar, provide: current state, risks identified, and specific recommendations with priority (high/medium/low).
```

`packages/cli/prompts/cost.md`:
```markdown
---
description: Optimize AWS infrastructure costs or give cost advice
---
Analyze the current project for AWS cost optimization. If CDK or infrastructure code exists, review it and suggest specific optimizations. If no infrastructure code exists, analyze the codebase and provide cost-effective architecture recommendations.

Focus on:
- Right-sizing compute resources
- Reserved/Spot instance opportunities
- Storage tier optimization
- Data transfer cost reduction
- Serverless vs provisioned trade-offs
- Caching strategies to reduce API calls
```

- [ ] **Step 2: Verify harness prompt tests pass**

```bash
cd packages/cli && bun test tests/harness.test.ts
```
Expected: All tests PASS (the `loadPrompt` tests now have real files to read)

- [ ] **Step 3: Commit**

```bash
git add packages/cli/prompts/
git rm -r packages/cli/.pi/prompts/
git commit -m "refactor(cli): move prompts from .pi/ to package root"
```

---

### Task 3: Refactor `src/commands.ts` to use PawlHarness

**Files:**
- Modify: `packages/cli/src/commands.ts`

- [ ] **Step 1: Refactor commands.ts**

Replace the current implementation with a thin ExtensionFactory wrapper around PawlHarness. Keep `scanCodebase` as a private function inside commands.ts for backward compat with the pi session (the harness already has it, but the ExtensionFactory context provides `ctx.exec` which pi's sandbox uses):

```typescript
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { PawlHarness } from "./harness";

export const pawlCommands: ExtensionFactory = (pi) => {
  pi.registerCommand("plan", {
    description: "Analyze codebase and generate AWS infrastructure plan",
    handler: async (args, ctx) => {
      const harness = new PawlHarness({
        cwd: ctx.cwd,
        exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
      });
      const prompt = await harness.commands.plan(args);
      await ctx.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("generate", {
    description: "Generate CDK infrastructure code from approved plan",
    handler: async (_args, ctx) => {
      const harness = new PawlHarness({
        cwd: ctx.cwd,
        exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
      });
      const prompt = await harness.commands.generate();
      await ctx.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("well-architected", {
    description: "Run AWS Well-Architected Framework review",
    handler: async (_args, ctx) => {
      const harness = new PawlHarness({
        cwd: ctx.cwd,
        exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
      });
      const prompt = await harness.commands.wellArchitected();
      await ctx.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("cost", {
    description: "Analyze and optimize AWS costs",
    handler: async (_args, ctx) => {
      const harness = new PawlHarness({
        cwd: ctx.cwd,
        exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
      });
      const prompt = await harness.commands.cost();
      await ctx.sendUserMessage(prompt);
    },
  });

  // Placeholder commands (not yet implemented)
  for (const cmd of ["deploy", "init", "simulate"]) {
    pi.registerCommand(cmd, {
      description: `${cmd} (not yet implemented)`,
      handler: async () => { /* TODO */ },
    });
  }
};
```

- [ ] **Step 2: Run all CLI tests**

```bash
cd packages/cli && bun test
```
Expected: All tests PASS

- [ ] **Step 3: Run lint**

```bash
bun lint
```
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands.ts
git commit -m "refactor(cli): commands.ts delegates to PawlHarness"
```

---

### Task 4: Create Flue agent definitions

**Files:**
- Create: `packages/cli/agents/plan.ts`
- Create: `packages/cli/agents/generate.ts`
- Create: `packages/cli/agents/well-architected.ts`

- [ ] **Step 1: Create plan agent**

`packages/cli/agents/plan.ts`:

```typescript
import type { FlueContext } from "@flue/runtime";
import { local } from "@flue/runtime/node";
import * as v from "valibot";
import { PawlHarness } from "../src/harness";

export const triggers = { webhook: true };

export default async function ({ init, payload, env }: FlueContext) {
  const harness = await init({
    sandbox: local({ env: { AWS_PROFILE: env.AWS_PROFILE, AWS_REGION: env.AWS_REGION } }),
    model: env.FLUE_MODEL ?? "anthropic/claude-sonnet-4-6",
  });
  const session = await harness.session();

  const pawl = new PawlHarness({
    cwd: process.cwd(),
    exec: async (cmd, args) => {
      const result = await session.shell(`${cmd} ${args.join(" ")}`);
      return { stdout: result.output };
    },
  });

  const planPrompt = await pawl.commands.plan(payload.notes);

  const { data } = await session.prompt(planPrompt, {
    result: v.object({
      summary: v.string(),
      architecture: v.string(),
      deployment: v.string(),
      filePlan: v.string(),
    }),
  });

  return data;
}
```

- [ ] **Step 2: Create generate agent**

`packages/cli/agents/generate.ts`:

```typescript
import type { FlueContext } from "@flue/runtime";
import { local } from "@flue/runtime/node";
import { PawlHarness } from "../src/harness";

export const triggers = { webhook: true };

export default async function ({ init, env }: FlueContext) {
  const harness = await init({
    sandbox: local({ env: { AWS_PROFILE: env.AWS_PROFILE, AWS_REGION: env.AWS_REGION } }),
    model: env.FLUE_MODEL ?? "anthropic/claude-sonnet-4-6",
  });
  const session = await harness.session();

  const pawl = new PawlHarness({
    cwd: process.cwd(),
    exec: async (cmd, args) => {
      const result = await session.shell(`${cmd} ${args.join(" ")}`);
      return { stdout: result.output };
    },
  });

  const generatePrompt = await pawl.commands.generate();
  await session.prompt(generatePrompt);

  return { status: "generated" };
}
```

- [ ] **Step 3: Create well-architected agent**

`packages/cli/agents/well-architected.ts`:

```typescript
import type { FlueContext } from "@flue/runtime";
import { local } from "@flue/runtime/node";
import * as v from "valibot";
import { PawlHarness } from "../src/harness";

export const triggers = { webhook: true };

interface PillarResult {
  pillar: string;
  currentState: string;
  risks: string[];
  recommendations: Array<{ text: string; priority: "high" | "medium" | "low" }>;
}

export default async function ({ init, env }: FlueContext) {
  const harness = await init({
    sandbox: local({ env: { AWS_PROFILE: env.AWS_PROFILE, AWS_REGION: env.AWS_REGION } }),
    model: env.FLUE_MODEL ?? "anthropic/claude-sonnet-4-6",
  });
  const session = await harness.session();

  const pawl = new PawlHarness({
    cwd: process.cwd(),
    exec: async (cmd, args) => {
      const result = await session.shell(`${cmd} ${args.join(" ")}`);
      return { stdout: result.output };
    },
  });

  const prompt = await pawl.commands.wellArchitected();
  const { data } = await session.prompt(prompt, {
    result: v.object({
      pillars: v.array(
        v.object({
          pillar: v.string(),
          currentState: v.string(),
          risks: v.array(v.string()),
          recommendations: v.array(
            v.object({ text: v.string(), priority: v.picklist(["high", "medium", "low"]) }),
          ),
        }),
      ),
    }),
  });

  return data;
}
```

- [ ] **Step 4: Add Flue dev dependencies**

Add to `packages/cli/package.json`:
```json
"@flue/runtime": "latest",
"valibot": "latest"
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/agents/ packages/cli/package.json
git commit -m "feat(cli): add Flue agent definitions for plan, generate, well-architected"
```

---

### Task 5: Update `index.ts` to use PawlHarness for codebase scanning

**Files:**
- Modify: `packages/cli/index.ts`

- [ ] **Step 1: Update index.ts imports**

Add the PawlHarness import. The existing TUI flow (profile selection, model selection, Bedrock check) stays the same. The only change: `index.ts` no longer needs to inline `scanCodebase` — the commands.ts ExtensionFactory (which now uses PawlHarness) handles it when the user invokes `/plan`.

No changes needed to the TUI flow itself — the `scanCodebase` function was already only used inside `commands.ts`, not in `index.ts`.

- [ ] **Step 2: Verify no regressions**

```bash
cd packages/cli && bun test
bun lint
```
Expected: All tests PASS, lint OK

- [ ] **Step 3: Commit**

```bash
git add packages/cli/index.ts
git commit -m "chore(cli): index.ts uses commands.ts with PawlHarness (no functional change)"
```

---

### Task 6: Update README and documentation

**Files:**
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Write new README**

```markdown
# pawl CLI

An AI-powered infrastructure agent that generates, reviews, and optimizes AWS infrastructure.

## Architecture

pawl CLI is built in two layers:

1. **`PawlHarness`** — Runtime-agnostic core that handles AWS credential management, codebase scanning, and prompt construction. Use this to integrate pawl with any agent framework.
2. **Pi TUI** — Interactive terminal interface powered by `pi-coding-agent`.
3. **Flue Agents** — HTTP-accessible agents powered by `@flue/runtime`.

## Usage

### Pi TUI (interactive terminal)

```bash
bun run index.ts
```

The CLI will:
1. Prompt you to select an AWS profile
2. Validate credentials (auto-login via SSO if needed)
3. Let you choose a Bedrock model
4. Start an interactive agent session

### Flue Agents (HTTP API)

```bash
npx flue dev --target node --env .env
curl http://localhost:3583/agents/plan/test-1 \
  -H "Content-Type: application/json" \
  -d '{"notes": "Use RDS, not DynamoDB"}'
```

### Harness (programmatic)

```typescript
import { PawlHarness } from "@pawl/cli/harness";

const harness = new PawlHarness({ cwd: "/path/to/project" });
const planPrompt = await harness.commands.plan("Use serverless architecture");
// Send planPrompt to your LLM of choice...
```

## Prerequisites

- AWS account with Bedrock access
- AWS SSO configured (`aws configure sso`)
- Bun runtime

## Built-in Commands

| Command | Description |
|---------|-------------|
| `/plan` | Analyze codebase, generate infrastructure plan |
| `/generate` | Generate CDK code from approved plan |
| `/well-architected` | AWS Well-Architected Framework review |
| `/cost` | Cost optimization analysis |
| `/deploy` | Deploy with CDK (TODO) |
| `/init` | Initialize new pawl project (TODO) |
| `/simulate` | Simulate infrastructure changes (TODO) |

## Built-in Prompts

Located in `prompts/`:
- `infra.md` — Generate AWS CDK infrastructure
- `well-architected.md` — Full Well-Architected review
- `cost.md` — Cost optimization

## Skills

Located in `skills/`:
- `pawl-constructs` — Reference for `@pawl/cdk` and `@pawl/lambda` APIs
- `pawl-plan` — Infrastructure plan generation workflow
- `pawl-codegen` — Infrastructure code generation workflow
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/README.md
git commit -m "docs(cli): update README with harness + Flue + TUI documentation"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun test --filter "@pawl/cli"
```

- [ ] **Step 2: Run lint**

```bash
bun lint
```

- [ ] **Step 3: Verify no pi imports leak into harness.ts**

```bash
grep -n "pi-coding-agent\|pi-ai" packages/cli/src/harness.ts
```
Expected: No matches

- [ ] **Step 4: Verify commands.ts is the only file with pi imports**

```bash
grep -rn "@earendil-works/pi" packages/cli/src/
```
Expected: Only `commands.ts`, `infra-agent.ts`, and `aws-guard.ts`

- [ ] **Step 5: Commit final state**

```bash
git commit -m "chore(cli): final verification pass"
```

---

## Dependency graph

```
Task 1 (harness.ts) ──→ Task 2 (move prompts) ──→ Task 3 (refactor commands.ts)
                                                        │
                                                        ├──→ Task 4 (Flue agents)
                                                        ├──→ Task 5 (index.ts cleanup)
                                                        └──→ Task 6 (README)
                                                              │
                                                              └──→ Task 7 (verification)
```

Tasks 1–3 are sequential. Tasks 4–6 can be done in parallel after Task 3. Task 7 depends on everything.
