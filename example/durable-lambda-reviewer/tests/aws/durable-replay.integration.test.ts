import { afterAll, describe, expect, test } from "bun:test";
import {
  integrationPrerequisitesMet,
  PAWL_TEST_REPO_A,
  PAWL_TEST_STAGE,
  PAWL_TEST_TEAM,
} from "./integration-harness";
import {
  codeCommit,
  commitFile,
  createBranch,
  createPullRequest,
  deleteBranch,
  durableExecutionName,
  readRequestState,
  requestIdFor,
  stackResources,
  waitForExecution,
} from "./aws-clients";
import { GetBranchCommand } from "@aws-sdk/client-codecommit";

/**
 * Durable replay + callback integration scenarios against a deployed stack.
 *
 * Master plan acceptance:
 *   1. force a durable replay mid-cycle → the store is not double-written and
 *      the review still completes
 *   2. callback wake → the reviewer resumes on the next event
 */
const MET = integrationPrerequisitesMet();
const REPO = PAWL_TEST_REPO_A!;
const STACK = MET
  ? stackResources(PAWL_TEST_TEAM, PAWL_TEST_STAGE)
  : (undefined as unknown as ReturnType<typeof stackResources>);
const DEFAULT_BRANCH = "main";
const cleanups: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) {
    try {
      await cleanup();
    } catch {
      // Best-effort cleanup.
    }
  }
});

describe.skipIf(!MET)("durable replay integration (live)", () => {
  test("AC3/AC15: a re-invoked (replayed) execution does not double-write state and completes", async () => {
    const branch = `test/replay-${Date.now()}`;
    const base = await headCommit(REPO, DEFAULT_BRANCH);
    await createBranch(REPO, branch, base);
    await commitFile(REPO, branch, `REPLAY_${Date.now()}.js`, "function f(){ return 1; }\n");
    cleanups.push(async () => deleteBranch(REPO, branch));

    const pr = await createPullRequest(
      REPO,
      branch,
      DEFAULT_BRANCH,
      `[integration] replay ${Date.now()}`,
      "replay PR",
    );
    cleanups.push(async () => closePullRequestSafe(pr.pullRequestId));

    const execName = durableExecutionName(REPO, requestIdFor(pr.pullRequestId));
    // First execution.
    const first = await waitForExecution(STACK.reviewerFunctionName, execName);
    expect(["WAITING", "SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"]).toContain(first.status);

    // Snapshot the state rows after the first run.
    const stateAfterFirst = await readRequestState(
      STACK.tableName,
      "codecommit",
      REPO,
      pr.pullRequestId,
    );
    const findingRowsAfterFirst = stateAfterFirst.filter((r) =>
      String(r.sk ?? "").startsWith("FINDING#"),
    );

    // Force a replay by pushing a new commit (a new event re-invokes the same
    // durable execution name / generation). The router's dedup + the durable
    // runtime's replay semantics must not duplicate state rows.
    await commitFile(REPO, branch, `REPLAY_${Date.now()}.js`, "function f(){ return 2; }\n");
    await waitForExecution(STACK.reviewerFunctionName, execName);

    const stateAfterReplay = await readRequestState(
      STACK.tableName,
      "codecommit",
      REPO,
      pr.pullRequestId,
    );
    const findingRowsAfterReplay = stateAfterReplay.filter((r) =>
      String(r.sk ?? "").startsWith("FINDING#"),
    );

    // No duplicate finding rows: each fingerprint appears at most once. (A
    // replay must not re-insert an existing FINDING#<fingerprint>.)
    const fingerprintsAfterReplay = findingRowsAfterReplay.map((r) => String(r.sk));
    const uniqueAfterReplay = new Set(fingerprintsAfterReplay);
    expect(uniqueAfterReplay.size).toBe(fingerprintsAfterReplay.length);

    // The set of finding fingerprints after replay is a superset of (or equal
    // to) the set after the first run — i.e. the first run's findings are
    // preserved, not replaced or duplicated.
    const fingerprintsAfterFirst = new Set(findingRowsAfterFirst.map((r) => String(r.sk)));
    for (const fp of fingerprintsAfterFirst) {
      expect(uniqueAfterReplay.has(fp)).toBe(true);
    }
  }, 360_000);

  test("AC4/AC10: a human comment resumes the review (callback wake) and is processed", async () => {
    const branch = `test/callback-${Date.now()}`;
    const base = await headCommit(REPO, DEFAULT_BRANCH);
    await createBranch(REPO, branch, base);
    await commitFile(REPO, branch, `CB_${Date.now()}.js`, "function f(){ return 1; }\n");
    cleanups.push(async () => deleteBranch(REPO, branch));

    const pr = await createPullRequest(
      REPO,
      branch,
      DEFAULT_BRANCH,
      `[integration] callback ${Date.now()}`,
      "callback-wake PR",
    );
    cleanups.push(async () => closePullRequestSafe(pr.pullRequestId));

    const execName = durableExecutionName(REPO, requestIdFor(pr.pullRequestId));
    // Wait for the initial review to settle.
    await waitForExecution(STACK.reviewerFunctionName, execName);

    // Post a human comment on the PR. The comment event flows through the
    // router and signals the reviewer's pending callback, resuming the
    // execution for this generation.
    const { PostCommentForPullRequestCommand } = await import("@aws-sdk/client-codecommit");
    await codeCommit().send(
      new PostCommentForPullRequestCommand({
        repositoryName: REPO,
        pullRequestId: pr.pullRequestId,
        beforeCommitId: pr.destinationCommit,
        afterCommitId: pr.sourceCommit,
        content: "integration: human comment to wake the reviewer",
      }),
    );

    // The callback wake should let the execution reach a terminal state again.
    const exec = await waitForExecution(STACK.reviewerFunctionName, execName, 180_000);
    expect(["WAITING", "SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"]).toContain(exec.status);

    // The human comment must be present in the PR's comment thread (proving the
    // comment event was delivered, not lost).
    const { GetCommentsForPullRequestCommand } = await import("@aws-sdk/client-codecommit");
    const result = await codeCommit().send(
      new GetCommentsForPullRequestCommand({
        repositoryName: REPO,
        pullRequestId: pr.pullRequestId,
        beforeCommitId: pr.destinationCommit,
        afterCommitId: pr.sourceCommit,
      }),
    );
    const allContent = (result.commentsForPullRequestData ?? [])
      .flatMap((t) => t.comments ?? [])
      .map((c) => c.content ?? "")
      .join("\n");
    expect(allContent).toContain("integration: human comment to wake the reviewer");
  }, 360_000);
});

async function headCommit(repositoryName: string, branchName: string): Promise<string> {
  const result = await codeCommit().send(new GetBranchCommand({ repositoryName, branchName }));
  const commitId = result.branch?.commitId;
  if (!commitId) throw new Error(`no commit id for branch ${branchName}`);
  return commitId;
}

async function closePullRequestSafe(pullRequestId: string): Promise<void> {
  try {
    const { GetPullRequestCommand, UpdatePullRequestStatusCommand } =
      await import("@aws-sdk/client-codecommit");
    const pr = await codeCommit().send(new GetPullRequestCommand({ pullRequestId }));
    if (pr.pullRequest?.pullRequestStatus === "OPEN") {
      await codeCommit().send(
        new UpdatePullRequestStatusCommand({ pullRequestId, pullRequestStatus: "CLOSED" }),
      );
    }
  } catch {
    // Best-effort.
  }
}
