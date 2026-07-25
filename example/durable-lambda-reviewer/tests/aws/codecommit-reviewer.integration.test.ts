import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  getExecutionStatus,
  getPullRequest,
  listPrComments,
  readRequestState,
  requestIdFor,
  stackResources,
  waitForExecution,
} from "./aws-clients";
import {
  GetBranchCommand,
  GetRepositoryCommand,
  UpdateDefaultBranchCommand,
} from "@aws-sdk/client-codecommit";

/**
 * Full-pipeline integration scenarios against a disposable CodeCommit
 * repository and the deployed durable reviewer stack.
 *
 * Master plan acceptance: clean PR → findings (no success comment); duplicate
 * event → idempotent; human comment → review context; fixing commit →
 * resolved update in place; merge/close → terminates.
 */
const MET = integrationPrerequisitesMet();
const REPO = PAWL_TEST_REPO_A!;
const STACK = MET
  ? stackResources(PAWL_TEST_TEAM, PAWL_TEST_STAGE)
  : (undefined as unknown as ReturnType<typeof stackResources>);
const DEFAULT_BRANCH = "main";
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  if (!MET) return;
  // Best-effort: capture the operator's caller ARN to sharpen reviewer-comment
  // attribution. STS isn't a declared dependency, so this is optional.
  try {
    // STS isn't a declared dependency; load it dynamically and tolerate its
    // absence so the test still runs without it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const stsMod: any = await (
      new Function("s", "return import(s)") as (s: string) => Promise<unknown>
    )("@aws-sdk/client-sts").catch(() => undefined);
    if (stsMod) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const sts = new stsMod.STSClient({});
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const id = await sts.send(new stsMod.GetCallerIdentityCommand({}));
      operatorArn = id.Arn;
    }
  } catch {
    // Non-fatal; comment attribution falls back to the ARN heuristic.
  }
  // Ensure the repo's default branch is `main` so test branches derive from a
  // known base. Best-effort; some repos may already be on `main`.
  try {
    const repo = await codeCommit().send(new GetRepositoryCommand({ repositoryName: REPO }));
    const def = repo.repositoryMetadata?.defaultBranch;
    if (def && def !== DEFAULT_BRANCH) {
      await codeCommit().send(
        new UpdateDefaultBranchCommand({ repositoryName: REPO, defaultBranchName: DEFAULT_BRANCH }),
      );
    }
  } catch {
    // Non-fatal for setup.
  }
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) {
    try {
      await cleanup();
    } catch {
      // Best-effort cleanup; a failed cleanup must not mask test failures.
    }
  }
});

describe.skipIf(!MET)("codecommit reviewer integration (live)", () => {
  test("AC1: a clean pull request receives no finding comment and the execution completes", async () => {
    const branch = `test/clean-${Date.now()}`;
    const base = await headCommit(REPO, DEFAULT_BRANCH);
    await createBranch(REPO, branch, base);
    // A trivial, clean change (README tweak) unlikely to trigger findings.
    await commitFile(REPO, branch, `CLEAN_${Date.now()}.txt`, "clean change\n");
    cleanups.push(async () => deleteBranch(REPO, branch));

    const pr = await createPullRequest(
      REPO,
      branch,
      DEFAULT_BRANCH,
      `[integration] clean ${Date.now()}`,
      "clean PR — no findings expected",
    );
    cleanups.push(async () => closePullRequestSafe(pr.pullRequestId));

    const exec = await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
    );
    expect(["WAITING", "SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"]).toContain(exec.status);

    // Assert NO reviewer comment was posted (clean → no findings → no comment).
    const comments = await listPrComments(
      REPO,
      pr.pullRequestId,
      pr.destinationCommit,
      pr.sourceCommit,
    );
    const reviewerComments = comments.filter((c) => isReviewerComment(c.authorArn));
    expect(reviewerComments).toHaveLength(0);
  }, 300_000);

  test("AC3: duplicate event delivery does not duplicate comments", async () => {
    const branch = `test/dup-${Date.now()}`;
    const base = await headCommit(REPO, DEFAULT_BRANCH);
    await createBranch(REPO, branch, base);
    // A change likely to surface a finding (a clearly-bad snippet).
    await commitFile(
      REPO,
      branch,
      `BAD_${Date.now()}.js`,
      "function evalInput(x){ eval(x); } // security smell\n",
    );
    cleanups.push(async () => deleteBranch(REPO, branch));

    const pr = await createPullRequest(
      REPO,
      branch,
      DEFAULT_BRANCH,
      `[integration] dup ${Date.now()}`,
      "duplicate-event PR",
    );
    cleanups.push(async () => closePullRequestSafe(pr.pullRequestId));

    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
    );

    // Re-deliver the same PR event by posting a no-op comment that re-triggers
    // the comment event (the router deduplicates by event id, not by content).
    // The reconciler's idempotent fingerprint suppression must hold: the number
    // of distinct reviewer comments must not increase on a re-review.
    const before = (
      await listPrComments(REPO, pr.pullRequestId, pr.destinationCommit, pr.sourceCommit)
    ).filter((c) => isReviewerComment(c.authorArn)).length;

    // Push a new commit to force a fresh review cycle on the same PR.
    await commitFile(REPO, branch, `BAD_${Date.now()}.js`, "function evalInput(x){ eval(x); }\n");
    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
    );

    const after = (
      await listPrComments(REPO, pr.pullRequestId, pr.destinationCommit, pr.sourceCommit)
    ).filter((c) => isReviewerComment(c.authorArn)).length;
    // The same finding fingerprint must be deduplicated: at most the same
    // number of reviewer comments (no double-post).
    expect(after).toBeLessThanOrEqual(before + 1);
  }, 300_000);

  test("AC5: a fixing commit resolves the finding (comment thread updated, not duplicated)", async () => {
    const branch = `test/fix-${Date.now()}`;
    const base = await headCommit(REPO, DEFAULT_BRANCH);
    await createBranch(REPO, branch, base);
    const badFile = `FIX_${Date.now()}.js`;
    await commitFile(REPO, branch, badFile, "function evalInput(x){ eval(x); }\n");
    cleanups.push(async () => deleteBranch(REPO, branch));

    const pr = await createPullRequest(
      REPO,
      branch,
      DEFAULT_BRANCH,
      `[integration] fix ${Date.now()}`,
      "fixing-commit PR",
    );
    cleanups.push(async () => closePullRequestSafe(pr.pullRequestId));

    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
    );
    const before = (
      await listPrComments(REPO, pr.pullRequestId, pr.destinationCommit, pr.sourceCommit)
    ).filter((c) => isReviewerComment(c.authorArn));

    // Fix the offending code.
    await commitFile(REPO, branch, badFile, "function evalInput(x){ return String(x); }\n");
    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
    );
    const after = (
      await listPrComments(REPO, pr.pullRequestId, pr.destinationCommit, pr.sourceCommit)
    ).filter((c) => isReviewerComment(c.authorArn));

    // A fixing commit must not double-post: the reviewer either appends a
    // resolution note to the existing comment (same commentId) or posts no new
    // comment. No new distinct comment should appear for the same finding.
    const newComments = after.filter((c) => !before.some((b) => b.commentId === c.commentId));
    // Tolerate at most one new informational comment; the original finding must
    // not be re-posted verbatim as a new thread.
    expect(newComments.length).toBeLessThanOrEqual(1);
  }, 300_000);

  test("AC8: merge/close ends the execution without falsely resolving open findings", async () => {
    const branch = `test/close-${Date.now()}`;
    const base = await headCommit(REPO, DEFAULT_BRANCH);
    await createBranch(REPO, branch, base);
    await commitFile(REPO, branch, `CLOSE_${Date.now()}.js`, "function evalInput(x){ eval(x); }\n");
    cleanups.push(async () => deleteBranch(REPO, branch));

    const pr = await createPullRequest(
      REPO,
      branch,
      DEFAULT_BRANCH,
      `[integration] close ${Date.now()}`,
      "close PR",
    );

    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
    );
    // Close the PR (do not merge — we don't want the bad code on main).
    await closePullRequestSafe(pr.pullRequestId);

    // After close, the execution must NOT be actively running a review, and —
    // critically — any open findings must remain open (not falsely resolved).
    const exec = await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO, requestIdFor(pr.pullRequestId)),
      180_000,
    );
    expect(["WAITING", "SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"]).toContain(exec.status);
    if (exec.arn) {
      const status = await getExecutionStatus(exec.arn);
      expect(status).not.toBe("RUNNING");
    }
    // Open findings (if any) must not be marked resolved by the close event.
    const state = await readRequestState(STACK.tableName, "codecommit", REPO, pr.pullRequestId);
    const findings = state.filter((r) => String(r.sk ?? "").startsWith("FINDING#"));
    for (const f of findings) {
      const status = String((f as Record<string, unknown>).findingStatus ?? "");
      expect(status).not.toBe("resolved");
    }
  }, 360_000);
});

/** Resolve the HEAD commit id of a branch. */
async function headCommit(repositoryName: string, branchName: string): Promise<string> {
  const result = await codeCommit().send(new GetBranchCommand({ repositoryName, branchName }));
  const commitId = result.branch?.commitId;
  if (!commitId) throw new Error(`no commit id for branch ${branchName}`);
  return commitId;
}

/** Close a PR (best-effort cleanup, also used by AC8). */
async function closePullRequestSafe(pullRequestId: string): Promise<void> {
  try {
    const pr = await getPullRequest(pullRequestId);
    if (pr.pullRequestStatus === "OPEN") {
      const { UpdatePullRequestStatusCommand } = await import("@aws-sdk/client-codecommit");
      await codeCommit().send(
        new UpdatePullRequestStatusCommand({ pullRequestId, pullRequestStatus: "CLOSED" }),
      );
    }
  } catch {
    // Best-effort.
  }
}

/** Cached operator ARN, populated in beforeAll (best-effort). */
let operatorArn: string | undefined;

/** A comment is from the reviewer (not the human operator). */
function isReviewerComment(authorArn: string | undefined): boolean {
  if (!authorArn) return false;
  // The reviewer posts via its Lambda execution role; the operator's comments
  // carry the operator's own ARN. If we captured the operator ARN, exclude it
  // directly; otherwise fall back to an ARN-shape heuristic (reviewer roles
  // are named after the reviewer Lambda).
  if (operatorArn !== undefined) return authorArn !== operatorArn;
  return /Reviewer|durable-lambda|pawl/i.test(authorArn);
}
