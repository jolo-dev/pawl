# pawl AWS Analysis + Custom TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give pawl a read-only **resource scan** that compares a project's **synthesized resources** against the **deployed resources** of one account and region, turn that comparison into **suggestions** to adopt pawl constructs, and ship it through a branded OpenTUI client that also carries the deploy approval.

**Architecture:** Three layers, built outward from pure logic.

1. **Identity and drift** (`packages/cli/src/infra/`) — pure, dependency-free, fully unit-testable. Decides whether a deployed resource *is* the one the code declared.
2. **Scanners** (`packages/cli/src/infra/scan/`) — one module per service behind a common interface, each reporting coverage. Never throws on a denied call.
3. **Surfaces** — an eve `scan_resources` tool, an `infra-auditor` subagent, and a custom OpenTUI client driving `eve/client` over HTTP.

**Tech Stack:** TypeScript, Bun (package manager/test runner), AWS SDK v3 (`@aws-sdk/client-*`, `@aws-sdk/credential-providers`), Zod, eve (agent runtime), OpenTUI (client), `@clack/prompts` (retired from the shipped path).

**Decisions already recorded:** `docs/adr/0001-custom-opentui-client.md`, `docs/adr/0002-per-service-resource-scanners.md`, glossary in `CONTEXT.md`.

**Hard constraints (repo rules, will break the build if ignored):**

- Authored eve modules (`agent/**`) are bundled for eve's Node runtime: **no `bun` imports**, and keep the import graph light. `@pawl/cdk` must never enter the agent graph.
- Authored tools run in the **app runtime**, not the sandbox: resolve the user's project with `projectDir()`, never `process.cwd()`.
- AWS credentials come from `fromNodeProviderChain()`; the launcher exports `AWS_PROFILE`/`AWS_REGION`.
- Gates: `bunx biome check`, `bun test packages/cli`, `bunx eve info` (0 diagnostics). `bunx tsc --noEmit` has ~50 pre-existing errors, none in the migration surface — do not add new ones.

---

## The naming convention this rests on

`BasicConstruct` sets `prefix = "{team}-{stage}-"` (iterating `BasicTags` keys in order) and tags every resource with `team` and `stage`. Constructs then pin physical names:

| Suffix | Property | Construct |
| --- | --- | --- |
| `-lambda` | `functionName` | `LambdaFunction` |
| `-apigateway` | `apiName` / `restApiName` | `ApiGateway` / `ApiGatewayV1` |
| `-table` | `tableName` | `DynamoDbTable` |
| `-sqs`, `-dlq` | `queueName` | `Sqs` |
| `-pipeline` | pipeline name | `CodePipeline` |
| `-appsync-event-api` | `apiName` | `Websocket` |
| `-agentcore` | `name` | `AgentCore` |
| `/aws/pawl/{prefix}/{id}/logs` | `logGroupName` | `ApiGateway` log group |
| `/aws/vendedlogs/{prefix}/{id}/logs` | `logGroupName` | `ApiGatewayV1` log group |

**Two edge cases that will bite a naive parser:**
1. **`AgentCore` sanitizes**: `[^a-zA-Z0-9_]` → `_` and truncates to 48, so `platform-dev-myid-agentcore` becomes `platform_dev_myid_agentcore`. The parser must accept `_` separators for this kind.
2. **`-dlq` is ambiguous** — both `Sqs` and `EventBridge` produce it (`EventBridge` uses `{eventBusName}-dlq`, not `{id}`). Disambiguate with tags, not the name.
3. **`CodeBuild` and `CodeCommit` take names from props**, not the prefix, so their provenance is tags-only.

---

## File Structure

### Created — identity and drift
| Path | Responsibility |
| --- | --- |
| `packages/cli/src/infra/provenance.ts` | Parse a physical name into `{team, stage, constructId, kind}`; expose the suffix→construct table |
| `packages/cli/src/infra/drift.ts` | Classify synthesized vs deployed into drift entries |
| `packages/cli/tests/infra-provenance.test.ts` | Provenance parsing tests |
| `packages/cli/tests/infra-drift.test.ts` | Drift classification tests |

### Created — scanners
| Path | Responsibility |
| --- | --- |
| `packages/cli/src/infra/scan/types.ts` | `ResourceScanner`, `DeployedResource`, `ServiceCoverage`, `ResourceScanResult` |
| `packages/cli/src/infra/scan/run.ts` | Run a scanner set, collect coverage, never fail the whole scan on one denial |
| `packages/cli/src/infra/scan/tagging.ts` | Resource Groups Tagging API broad net |
| `packages/cli/src/infra/scan/<service>.ts` | One scanner per service (see Task 4 and 5) |
| `packages/cli/src/infra/scan/index.ts` | The scanner registry |
| `packages/cli/tests/infra-scan.test.ts` | Coverage + failure-isolation tests with fake scanners |
| `packages/cli/tests/infra-scan-<service>.test.ts` | Per-service fixture tests with mocked clients |

### Created — suggestions and agent surface
| Path | Responsibility |
| --- | --- |
| `packages/cli/src/infra/suggestions.ts` | Deterministic deployed-kind → candidate pawl construct rules |
| `packages/cli/agent/tools/scan_resources.ts` | eve tool: run the scan, return the result with coverage |
| `packages/cli/agent/subagents/infra-auditor/{agent.ts,instructions.md}` | Ranks and explains suggestions from a scan |

### Created — deploy, policy, client
| Path | Responsibility |
| --- | --- |
| `packages/cli/src/deploy/diff.ts` | Produce the `cdk diff` approval artifact |
| `packages/cli/agent/tools/deploy_infra.ts` | Approval-gated deploy tool |
| `packages/cli/iam/pawl-readonly-policy.json` | The read-only permission set |
| `packages/cli/src/tui/` | OpenTUI client |
| `packages/cli/tests/tui-*.test.ts` | Client unit tests (pure logic only; rendering is not unit-tested) |

### Modified
| Path | Change |
| --- | --- |
| `packages/cli/agent/tools/well_architected.ts` | Consume a resource scan |
| `packages/cli/agent/tools/cost.ts` | Consume a resource scan; state the Cost Explorer gap |
| `packages/cli/agent/instructions.md` | Document the analyze-then-create workflow and the read-only boundary |
| `packages/cli/index.ts` | Hand off to the pawl TUI instead of `eve dev` |
| `packages/cli/README.md` | Document the scan, permissions, and the TUI |

---

## Task 1: Provenance parsing

**Files:** create `src/infra/provenance.ts`, `tests/infra-provenance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { PAWL_NAME_SUFFIXES, parsePawlName } from "../src/infra/provenance";

describe("parsePawlName", () => {
	test("recovers team, stage, construct id and construct kind", () => {
		expect(parsePawlName("platform-dev-myapi-lambda")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myapi",
			kind: "LambdaFunction",
		});
	});

	test("handles a hyphenated construct id", () => {
		expect(parsePawlName("platform-prod-order-worker-sqs")).toEqual({
			team: "platform",
			stage: "prod",
			constructId: "order-worker",
			kind: "Sqs",
		});
	});

	test("handles the AgentCore underscore-sanitised form", () => {
		expect(parsePawlName("platform_dev_myid_agentcore")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myid",
			kind: "AgentCore",
		});
	});

	test("parses the ApiGateway log-group path form", () => {
		expect(parsePawlName("/aws/pawl/platform-dev-myapi/logs")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myapi",
			kind: "ApiGatewayLogGroup",
		});
	});

	test("marks -dlq as ambiguous rather than guessing", () => {
		expect(parsePawlName("platform-dev-orders-dlq")?.kind).toBe("AmbiguousDlq");
	});

	test("rejects a name with no pawl suffix", () => {
		expect(parsePawlName("my-random-bucket")).toBeNull();
	});

	test("rejects a name with an unknown stage", () => {
		expect(parsePawlName("platform-staging-myapi-lambda")).toBeNull();
	});
});

describe("PAWL_NAME_SUFFIXES", () => {
	test("every suffix maps to a construct name and a resource kind", () => {
		for (const [suffix, entry] of Object.entries(PAWL_NAME_SUFFIXES)) {
			expect(suffix.startsWith("-")).toBe(true);
			expect(entry.construct.length).toBeGreaterThan(0);
			expect(entry.resourceKind.length).toBeGreaterThan(0);
		}
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/infra-provenance.test.ts
```

- [ ] **Step 3: Implement `src/infra/provenance.ts`**

Export `Stage` (`"dev" | "qa" | "prod"`), `PawlProvenance`, `PAWL_NAME_SUFFIXES`, and `parsePawlName`. Rules: exact-name parsing only (no heuristics), longest suffix wins, `-dlq` → `AmbiguousDlq`, unknown stage → `null`, trailing `.fifo` stripped before matching.

- [ ] **Step 4: Verify**

```bash
cd /Users/jolo/Development/pawl/packages/cli && bun test tests/infra-provenance.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/infra/provenance.ts packages/cli/tests/infra-provenance.test.ts
git commit -m "feat(cli): parse pawl provenance from resource names"
```

---

## Task 2: Drift classification

**Files:** create `src/infra/drift.ts`, `tests/infra-drift.test.ts`

- [ ] **Step 1: Write the failing test** covering: CFN logical id match wins; fallback match on `team`+`stage`+parsed name; deployed-without-synthesized = `"unmanaged"`; synthesized-without-deployed = `"not-deployed"`; a deployed resource with pawl tags that parses to a *different* construct id is `"foreign"` (the R8 ambiguity, reported not guessed).

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement `classifyDrift(synthesized, deployed)`** returning `DriftEntry[]` with `status: "matched" | "not-deployed" | "unmanaged" | "foreign"` plus the identifiers used for the match, so the UI can explain *why* two things were paired.

- [ ] **Step 4: Verify, then commit** `feat(cli): classify synthesized-vs-deployed drift`.

---

## Task 3: Scanner interface, coverage, and failure isolation

**Files:** create `src/infra/scan/types.ts`, `src/infra/scan/run.ts`, `tests/infra-scan.test.ts`

- [ ] **Step 1: Write the failing test**: a fake scanner that resolves contributes its resources; a fake scanner that rejects with `AccessDenied` contributes a `denied` coverage entry **and the overall scan still succeeds**; a scanner that rejects with a transport error contributes `error`; the result totals report scanned vs denied services.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement** `ResourceScanner` (`{ service, scan(ctx): Promise<DeployedResource[]> }`), `ServiceCoverage` (`"scanned" | "denied" | "error" | "unsupported"`), `runScanners(scanners, ctx)` isolating each failure, and `ResourceScanResult` carrying `resources` + `coverage`.

- [ ] **Step 4: Verify, then commit** `feat(cli): resource scanner interface with explicit coverage`.

---

## Task 4: First scanners (Lambda, DynamoDB, SQS, API Gateway v1+v2)

**Files:** create `src/infra/scan/{lambda,dynamodb,sqs,apigateway}.ts`, `tests/infra-scan-lambda.test.ts` (+ one per service), and a shared `tests/fixtures/aws/` directory

- [ ] **Step 1: Write the failing test** for the Lambda scanner, using the repo's existing fail-closed mock pattern (`mockSend(...)` as in `tests/aws-credentials.test.ts`), asserting it calls `ListFunctions` and maps `FunctionName`, `FunctionArn`, tags, `CodeSize`, `Runtime`, `MemorySize`.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement the Lambda scanner**, then repeat Steps 1–2 for DynamoDB (`ListTables` + `DescribeTable` + `ListTagsOfResource`), SQS (`ListQueues` + `GetQueueAttributes`), and API Gateway (`GetRestApis` for v1, `GetApis` for v2).

- [ ] **Step 4: Verify all four, then commit** `feat(cli): scan lambda, dynamodb, sqs and api gateway`.

---

## Task 5: Remaining pawl-service scanners

**Files:** create one module + test per remaining service

Cover, in this order: `sns`, `s3`, `eventbridge`, `codebuild`, `codecommit`, `codepipeline`, `cognito`, `cloudfront`, `logs`, `iam`, `kms`, `ec2` (VPC and security groups only), `appsync`, `agentcore`, and the `tagging` broad net.

Per service: write the failing fixture test first, implement, verify, commit individually (`feat(cli): scan <service>`). Each scanner must return `unsupported` for regions where the service is absent rather than throwing.

- [ ] **Step 1–4 per service.** Services whose resources cannot be enumerated without a broader grant (IAM, KMS, EC2) must degrade to coverage `denied` and never block the scan.

---

## Task 6: `scan_resources` tool

**Files:** create `agent/tools/scan_resources.ts`, `tests/agent-tools.test.ts` (extend)

- [ ] **Step 1: Write the failing test**: the tool's schema accepts `{}` and the tool is exported with a description; extend the existing "every migrated tool exposes a description and an input schema" test.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** the tool: build the scanner registry, run it against `projectDir()`'s synthesized output (`cdk synth` via `PawlHarness` exec) and the live account, return `RunScanners` result plus drift, with coverage prominent.
- [ ] **Step 4: Verify with `bunx eve info` (tools count increments, 0 diagnostics), then commit.**

---

## Task 7: Suggestion rules

**Files:** create `src/infra/suggestions.ts`, `tests/infra-suggestions.test.ts`

- [ ] **Step 1: Write the failing test**: a deployed Lambda not already matching a pawl name yields a `LambdaFunction` candidate; a resource already matching a pawl name yields no suggestion; an ambiguous `-dlq` yields a candidate only when tags identify the owner.
- [ ] **Step 2–4: Implement, verify, commit** `feat(cli): deterministic pawl construct suggestions`.

---

## Task 8: `infra-auditor` subagent

**Files:** create `agent/subagents/infra-auditor/{agent.ts,instructions.md}`, extend `tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing test** extending the existing "each declared subagent has a description and an agent config" case with `infra-auditor`.
- [ ] **Step 2–4: Implement** with a zod `outputSchema` of ranked suggestions (construct, rationale, effort, risk), verify with `bunx eve info` (subagents 4), commit.

---

## Task 9: Feed scans into `well_architected` and `cost`

**Files:** modify `agent/tools/well_architected.ts`, `agent/tools/cost.ts`, `agent/instructions.md`

- [ ] **Step 1: Write the failing test** asserting both tools can receive a scan result and that `cost`'s output admits when Cost Explorer data is absent.
- [ ] **Step 2–4: Implement, verify, commit** `feat(cli): make the reviews observe the account`.

---

## Task 10: Deploy approval on `cdk diff`

**Files:** create `src/deploy/diff.ts`, `agent/tools/deploy_infra.ts`, `tests/deploy-diff.test.ts`

- [ ] **Step 1: Write the failing test**: `buildDeployDecision({ stack, diff })` returns a decision object carrying the diff text and whether the diff is empty; an empty diff is reported as "nothing to deploy".
- [ ] **Step 2–4: Implement** the `cdk diff` wrapper and an `always()`-gated `deploy_infra` tool that runs `cdk deploy` from the app runtime against `projectDir()`, verifying `eve info` still reports 0 diagnostics, then commit.

---

## Task 11: Read-only IAM policy

**Files:** create `packages/cli/iam/pawl-readonly-policy.json`, `tests/iam-policy.test.ts`

- [ ] **Step 1: Write the failing test** asserting the policy contains only `Describe*`/`List*`/`Get*` actions, contains no `*` action, and covers every action the scanners reference (parse the scanner sources for `new List*Command`/`new Describe*Command`/`GetResourcesCommand` and assert each maps to an allowed action).
- [ ] **Step 2–4: Implement, verify, commit** `docs(cli): publish the read-only scan permission set`.

---

## Task 12: OpenTUI client foundation

**Files:** create `src/tui/{app.ts,theme.ts,client.ts}`, `tests/tui-client.test.ts`

- [ ] **Step 1: Write the failing test** for the pure layer only: `theme.ts` exports the tokens read from `docs/DESIGN.md` (redline-ink, charcoal-paper, chalk-text, chalk-bright), and `client.ts` wraps `eve/client` with a `send(message)` + `onEvent(cb)` seam that can be driven by a fake transport.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** the client wrapper and theme; add `@opentui/core` and the eve client import. Confirm the runtime: Bun 1.3+ (ours 1.4.2) or Node 26.4+ with `--experimental-ffi`.
- [ ] **Step 4: Verify, commit** `feat(cli): OpenTUI client foundation`.

---

## Task 13: Preflight inside the TUI

**Files:** modify `index.ts`, create `src/tui/preflight.ts`, `tests/tui-preflight.test.ts`

- [ ] **Step 1: Write the failing test** for the pure preflight state machine (profile → credentials → region → model → bedrock access), driven by injected prompt functions so no TTY is needed.
- [ ] **Step 2–4: Implement** the state machine, render it in OpenTUI, and keep `src/aws-credentials.ts` and `src/bedrock-models.ts` untouched so their tests keep covering the logic. Retire `@clack/prompts` from `index.ts`. Commit `feat(cli): absorb the AWS preflight into the pawl TUI`.

---

## Task 14: Approvals, questions, and streaming in the TUI

**Files:** extend `src/tui/`, `tests/tui-events.test.ts`

- [ ] **Step 1: Write the failing test** for the pure event reducer: `message.delta` accumulates text; `action.input`/`action.result` render as tool calls; an approval request produces a renderable prompt; answering it produces the `inputResponses` payload `Client` expects; `turn.failed` surfaces the error code without losing the transcript.
- [ ] **Step 2–4: Implement**, render streaming text, tool calls, approvals, and questions; verify end-to-end against a local `eve dev --no-ui` with a real Bedrock turn; commit `feat(cli): render streaming, tool calls and approvals`.

---

## Task 15: Documentation

**Files:** modify `packages/cli/README.md`, `AGENTS.md`

- [ ] **Step 1: Document** the analyze-then-create workflow, the read-only analysis boundary, the required permissions, the runtime requirement, and the new tools/subagent.
- [ ] **Step 2: Verify no stale references** and commit `docs(cli): document analysis, permissions and the pawl TUI`.

---

## Verification (whole feature)

```bash
cd /Users/jolo/Development/pawl && bunx biome check .
cd /Users/jolo/Development/pawl/packages/cli && bun test
cd /Users/jolo/Development/pawl/packages/cli && bunx eve info      # 0 diagnostics
cd /Users/jolo/Development/pawl/packages/cli && bunx tsc --noEmit  # no NEW errors
```

Plus one **live** end-to-end check, because no mock proves the scan works against a real account: run `scan_resources` against the account behind `AWS_PROFILE=jolo` in `eu-central-1` and confirm coverage reports every service as scanned or denied, with no service silently missing.

## Risks

| Risk | Handling |
| --- | --- |
| 18 scanners is a large surface; a wrong shape per service is silent | Fixture-test every scanner against a recorded, realistic response shape |
| Per-service `List` APIs need many small grants | Task 11 generates the policy from the scanner sources, so it cannot drift |
| `cdk synth` can be slow or fail on a broken app | Treat synth failure as a first-class error the user sees, never as "no drift" |
| OpenTUI on Node needs `--experimental-ffi` | Run the client under Bun, which is already pawl's runtime |
| Scan output is large enough to flood the root context | The `infra-auditor` subagent consumes it; Task 6 keeps the raw tool output bounded |
| Cost advice without Cost Explorer is guesswork | Task 9 makes `cost` state that explicitly |
