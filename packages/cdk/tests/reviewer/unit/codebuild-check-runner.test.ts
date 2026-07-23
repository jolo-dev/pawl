import { describe, expect, test } from "bun:test";
import type {
  BatchGetBuildsCommandInput,
  BatchGetBuildsCommandOutput,
  StartBuildCommandInput,
  StartBuildCommandOutput,
} from "@aws-sdk/client-codebuild";
import type {
  GetLogEventsCommandInput,
  GetLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CodeBuildCheckRunner,
  generateBuildspec,
  scrubLog,
  type CodeBuildTransport,
} from "../../../src/reviewer/adapters/codebuild-check-runner";
import type { RepositoryCheckConfig } from "../../../src/reviewer/domain/repository-config";
import type { ReviewCycleSnapshot } from "../../../src/reviewer/domain/review-request";
import type { CheckRunInput } from "../../../src/reviewer/ports/check-runner";

const snapshot: ReviewCycleSnapshot = {
  request: { provider: "codecommit", repository: "repo", requestId: "7" },
  generation: 1,
  cycle: 1,
  sourceRevision: "source-immutable-commit-1234567",
  destinationRevision: "destination-immutable-commit-1234567",
  configVersion: 1,
  eventWatermark: "source-immutable-commit-1234567",
  startedAt: "2026-01-01T00:00:00.000Z",
};

const checks: RepositoryCheckConfig[] = [
  { name: "types", command: "bunx tsc --noEmit", timeoutSeconds: 300 },
  { name: "lint", command: "bun run lint", timeoutSeconds: 120 },
];

function baseInput(overrides: Partial<CheckRunInput> = {}): CheckRunInput {
  return {
    request: snapshot.request,
    snapshot,
    checks,
    ...overrides,
  };
}

class FakeTransport implements CodeBuildTransport {
  readonly startBuildCalls: StartBuildCommandInput[] = [];
  readonly batchGetBuildsCalls: BatchGetBuildsCommandInput[] = [];
  #statuses: (string | undefined)[];
  #logEvents: string[];
  constructor(statuses: (string | undefined)[], logEvents: string[] = []) {
    this.#statuses = statuses;
    this.#logEvents = logEvents;
  }
  async startBuild(input: StartBuildCommandInput): Promise<StartBuildCommandOutput> {
    this.startBuildCalls.push(input);
    return {
      build: { id: "build-1", buildStatus: "IN_PROGRESS" },
      $metadata: {},
    } as StartBuildCommandOutput;
  }
  async batchGetBuilds(input: BatchGetBuildsCommandInput): Promise<BatchGetBuildsCommandOutput> {
    this.batchGetBuildsCalls.push(input);
    const status = this.#statuses.shift() ?? "IN_PROGRESS";
    return {
      builds: [
        {
          id: "build-1",
          buildStatus: status,
          logs: { cloudWatchLogs: { groupName: "g", streamName: "s" } },
        },
      ],
      $metadata: {},
    } as BatchGetBuildsCommandOutput;
  }
  async getLogEvents(_input: GetLogEventsCommandInput): Promise<GetLogEventsCommandOutput> {
    return {
      events: this.#logEvents.map((message) => ({ message, timestamp: 0 })),
      $metadata: {},
    } as GetLogEventsCommandOutput;
  }
}

function createRunner(
  transport: CodeBuildTransport,
  options: { maxPollMs?: number; maxLogBytes?: number } = {},
) {
  return new CodeBuildCheckRunner({
    transport,
    projectNames: { repo: "test-project" },
    clock: (() => {
      let t = 0;
      return () => new Date(t++);
    })(),
    sleep: async () => {},
    pollIntervalMs: 1,
    maxPollMs: options.maxPollMs ?? 1_000,
    maxLogBytes: options.maxLogBytes ?? 4_096,
  });
}

describe("CodeBuildCheckRunner", () => {
  test("StartBuild uses the exact source commit and a buildspec containing each check", async () => {
    const transport = new FakeTransport(["SUCCEEDED"], []);
    const runner = createRunner(transport);
    await runner.run(baseInput());

    expect(transport.startBuildCalls).toHaveLength(1);
    const req = transport.startBuildCalls[0];
    expect(req.projectName).toBe("test-project");
    expect(req.sourceVersion).toBe("source-immutable-commit-1234567");
    expect(req.buildspecOverride).toContain("bunx tsc --noEmit");
    expect(req.buildspecOverride).toContain("bun run lint");
    // No secrets in env vars — only the non-secret run id.
    const envVars = req.environmentVariablesOverride ?? [];
    expect(envVars).toHaveLength(1);
    expect(envVars[0]?.name).toBe("PAWL_CHECK_RUN_ID");
  });

  test("returns infrastructure-failure for an unknown repository", async () => {
    const transport = new FakeTransport(["SUCCEEDED"], []);
    const runner = createRunner(transport);
    const result = await runner.run(
      baseInput({
        request: { provider: "codecommit", repository: "unknown-repo", requestId: "7" },
      }),
    );
    expect(result.status).toBe("infrastructure-failure");
    if (result.status === "infrastructure-failure") {
      expect(result.code).toBe("UNKNOWN_REPOSITORY");
      expect(result.retryable).toBe(false);
    }
    expect(transport.startBuildCalls).toHaveLength(0);
  });

  test("SUCCEEDED maps to all checks passed", async () => {
    const logEvents = [
      "<<<CHECK:types:START>>>",
      "type check output",
      "<<<CHECK:types:EXIT:0>>>",
      "<<<CHECK:lint:START>>>",
      "lint output",
      "<<<CHECK:lint:EXIT:0>>>",
    ];
    const transport = new FakeTransport(["SUCCEEDED"], logEvents);
    const runner = createRunner(transport);

    const result = await runner.run(baseInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((c) => c.status === "passed")).toBe(true);
  });

  test("FAILED maps per-check exit codes", async () => {
    const logEvents = [
      "<<<CHECK:types:START>>>",
      "type errors",
      "<<<CHECK:types:EXIT:2>>>",
      "<<<CHECK:lint:START>>>",
      "<<<CHECK:lint:EXIT:0>>>",
    ];
    const transport = new FakeTransport(["FAILED"], logEvents);
    const runner = createRunner(transport);

    const result = await runner.run(baseInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.checks[0]?.status).toBe("failed");
    expect(result.checks[0]?.exitCode).toBe(2);
    expect(result.checks[1]?.status).toBe("passed");
  });

  test("FAULT maps to a retryable infrastructure-failure", async () => {
    const transport = new FakeTransport(["FAULT"], []);
    const runner = createRunner(transport);

    const result = await runner.run(baseInput());

    expect(result.status).toBe("infrastructure-failure");
    if (result.status !== "infrastructure-failure") return;
    expect(result.retryable).toBe(true);
  });

  test("STOPPED maps to a non-retryable infrastructure-failure", async () => {
    const transport = new FakeTransport(["STOPPED"], []);
    const runner = createRunner(transport);

    const result = await runner.run(baseInput());

    expect(result.status).toBe("infrastructure-failure");
    if (result.status !== "infrastructure-failure") return;
    expect(result.retryable).toBe(false);
  });

  test("poll timeout maps to timed-out", async () => {
    // Always returns IN_PROGRESS — never terminates.
    const transport = new FakeTransport([undefined], []);
    const runner = createRunner(transport, { maxPollMs: 0 });

    const result = await runner.run(baseInput());

    expect(result.status).toBe("timed-out");
  });

  test("log exceeding maxLogBytes is truncated with the flag set", async () => {
    const longOutput = "x".repeat(10_000);
    const logEvents = [
      "<<<CHECK:types:START>>>",
      longOutput,
      "<<<CHECK:types:EXIT:0>>>",
      "<<<CHECK:lint:START>>>",
      "<<<CHECK:lint:EXIT:0>>>",
    ];
    const transport = new FakeTransport(["SUCCEEDED"], logEvents);
    const runner = createRunner(transport, { maxLogBytes: 100 });

    const result = await runner.run(baseInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.checks[0]?.logTruncated).toBe(true);
    expect(result.checks[0]?.boundedLog.length).toBeLessThanOrEqual(100);
    // The non-truncated check is not flagged.
    expect(result.checks[1]?.logTruncated).toBe(false);
  });

  test("logs are scrubbed of AWS access-key IDs", async () => {
    const logEvents = [
      "<<<CHECK:types:START>>>",
      "using key AKIAEXAMPLE1234567890 here",
      "<<<CHECK:types:EXIT:0>>>",
      "<<<CHECK:lint:START>>>",
      "<<<CHECK:lint:EXIT:0>>>",
    ];
    const transport = new FakeTransport(["SUCCEEDED"], logEvents);
    const runner = createRunner(transport);

    const result = await runner.run(baseInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.checks[0]?.boundedLog).not.toContain("AKIAEXAMPLE1234567890");
    expect(result.checks[0]?.boundedLog).toContain("AKIA[REDACTED]");
  });
});

describe("generateBuildspec", () => {
  test("includes install phase when installCommand is present", () => {
    const spec = generateBuildspec(checks, "bun install --frozen-lockfile");
    expect(spec).toContain("install:");
    expect(spec).toContain("bun install --frozen-lockfile");
    expect(spec).toContain("bunx tsc --noEmit");
  });

  test("omits install phase when installCommand is absent", () => {
    const spec = generateBuildspec(checks);
    expect(spec).not.toContain("install:");
    expect(spec).toContain("build:");
  });
});

describe("scrubLog", () => {
  test("redacts access-key IDs and request IDs", () => {
    const scrubbed = scrubLog(
      "key AKIAIOSFODNN7EXAMPLE used RequestId: 12345678-1234-1234-1234-123456789012 done",
    );
    expect(scrubbed).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(scrubbed).not.toContain("12345678-1234-1234-1234-123456789012");
    expect(scrubbed).toContain("AKIA[REDACTED]");
    expect(scrubbed).toContain("RequestId: [REDACTED]");
  });
});
