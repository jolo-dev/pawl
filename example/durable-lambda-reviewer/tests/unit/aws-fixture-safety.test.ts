import { describe, expect, test } from "bun:test";
import path from "node:path";

const fixturesRoot = path.join(import.meta.dir, "../aws/fixtures");

async function fixtureFiles(): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.json");
  for await (const relativePath of glob.scan(fixturesRoot)) {
    files.push(relativePath);
  }
  return files.sort();
}

async function readFixture(relativePath: string): Promise<any> {
  return JSON.parse(await Bun.file(path.join(fixturesRoot, relativePath)).text());
}

describe("AWS contract fixture safety", () => {
  test("recursively parses every JSON fixture and rejects concrete identifiers", async () => {
    const files = await fixtureFiles();
    expect(files.length).toBeGreaterThan(0);

    const forbidden = [
      { name: "account ID", pattern: /\b\d{12}\b/ },
      { name: "AWS ARN", pattern: /arn:aws(?:-[a-z]+)?:/i },
      {
        name: "UUID",
        pattern: /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i,
      },
      { name: "40-character commit", pattern: /\b[0-9a-f]{40}\b/i },
      { name: "access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
      {
        name: "credential field",
        pattern:
          /(?:aws_secret_access_key|secretAccessKey|accessKeyId|sessionToken|aws_session_token|credentials?)/i,
      },
    ];

    for (const relativePath of files) {
      const raw = await Bun.file(path.join(fixturesRoot, relativePath)).text();
      JSON.parse(raw);
      for (const { name, pattern } of forbidden) {
        expect(raw, `${relativePath} contains a concrete ${name}`).not.toMatch(pattern);
      }
    }
  });

  test("preserves CodeCommit event identity relationships", async () => {
    const pullRequests = await readFixture("codecommit/native-pull-request-events.json");
    const [created, updated, closed, merged] = pullRequests.events;

    expect(pullRequests.events.map((event: any) => event.id)).toEqual([
      "<event-pr-1-created-id>",
      "<event-pr-1-source-updated-id>",
      "<event-pr-1-closed-id>",
      "<event-pr-2-merged-id>",
    ]);
    expect(created.detail.pullRequestId).toBe("<pull-request-1-id>");
    expect(updated.detail.pullRequestId).toBe(created.detail.pullRequestId);
    expect(closed.detail.pullRequestId).toBe(created.detail.pullRequestId);
    expect(merged.detail.pullRequestId).toBe("<pull-request-2-id>");
    expect(merged.detail.pullRequestId).not.toBe(created.detail.pullRequestId);

    const comments = await readFixture("codecommit/native-comment-events.json");
    const [topLevel, reply] = comments.events;
    expect(topLevel.id).toBe("<event-comment-top-level-id>");
    expect(reply.id).toBe("<event-comment-reply-id>");
    expect(reply.detail.pullRequestId).toBe(topLevel.detail.pullRequestId);
    expect(reply.detail.beforeCommitId).toBe(topLevel.detail.beforeCommitId);
    expect(reply.detail.afterCommitId).toBe(topLevel.detail.afterCommitId);
    expect(reply.detail.inReplyTo).toBe(topLevel.detail.commentId);
  });

  test("retains durable result nesting and structured cleanup absence evidence", async () => {
    const durable = await readFixture("durable/durable-execution-contract.json");
    const encodedResult = durable.getDurableExecution.terminalResponse.Result;
    expect(typeof encodedResult).toBe("string");

    const result = JSON.parse(encodedResult);
    expect(typeof result.tag).toBe("string");
    expect(result.tag).toBe("<workflow-tag>");
    expect(typeof result.callbackResult).toBe("string");
    expect(result.callbackResult.endsWith("\n")).toBe(true);
    expect(JSON.parse(result.callbackResult)).toEqual({ outcome: "accepted" });
    expect(durable.duplicateName.samePayload.response.DurableExecutionArn).toBe(
      durable.namedInvocation.response.DurableExecutionArn,
    );

    const cleanup = await readFixture("cleanup/cleanup-validation.json");
    expect(cleanup.validationRuns.length).toBeGreaterThanOrEqual(2);
    const coveredServices = new Set(
      cleanup.validationRuns.flatMap((run: any) =>
        run.resources.map((resource: any) => resource.service),
      ),
    );
    expect(coveredServices).toEqual(
      new Set(["codebuild", "codecommit", "events", "iam", "lambda", "logs", "sqs"]),
    );
    for (const run of cleanup.validationRuns) {
      expect(run.expectedManifestComplete).toBe(true);
      expect(run.residualResourceCount).toBe(0);
      expect(run.verifiedAbsent).toBe(true);
      expect(run.resources.length).toBeGreaterThan(0);
      for (const resource of run.resources) {
        expect(resource.absent).toBe(true);
        expect(resource.evidence).toBeDefined();
      }
    }

    const initial = cleanup.validationRuns.find(
      (run: any) => run.name === "initial-contract-capture",
    );
    const completion = cleanup.validationRuns.find(
      (run: any) => run.name === "durable-completion-capture",
    );
    const resource = (run: any, resourceType: string) =>
      run.resources.find((item: any) => item.resourceType === resourceType);

    expect(resource(initial, "project").evidence).toEqual({
      projects: [],
      projectsNotFound: ["<codebuild-project-name>"],
    });
    for (const resourceType of ["codebuild-log-group", "lambda-log-group"]) {
      expect(resource(initial, resourceType).evidence.logGroups).toEqual([]);
    }
    expect(resource(initial, "event-rule").evidence.error.code).toBe("ResourceNotFoundException");
    expect(resource(initial, "event-capture-queue").evidence.error.code).toBe(
      "AWS.SimpleQueueService.NonExistentQueue",
    );
    for (const resourceType of ["codebuild-role", "bedrock-role", "lambda-role"]) {
      expect(resource(initial, resourceType).evidence.error.code).toBe("NoSuchEntity");
    }
    expect(resource(initial, "function").evidence.error.code).toBe("ResourceNotFoundException");
    expect(resource(initial, "repository").evidence.error.code).toBe(
      "RepositoryDoesNotExistException",
    );

    expect(resource(completion, "function-alias-and-versions").evidence.error.code).toBe(
      "ResourceNotFoundException",
    );
    expect(resource(completion, "lambda-log-group").evidence.logGroups).toEqual([]);
    expect(resource(completion, "callback-capture-queue").evidence.stdoutBytes).toBe(0);
    for (const resourceType of ["lambda-role", "bedrock-role"]) {
      expect(resource(completion, resourceType).evidence.error.code).toBe("NoSuchEntity");
    }
  });

  test("preserves an absent idempotency mismatch message without fabricating one", async () => {
    const mutations = await readFixture("codecommit/comment-mutation-contract.json");
    const mismatch = mutations.idempotency.sameTokenChangedContent.error;
    expect(mismatch.messagePresent).toBe(false);
    expect(Object.hasOwn(mismatch, "message")).toBe(false);
    expect(mismatch.sanitizationNote).toContain("CLI stderr contained no service message");
  });
});
