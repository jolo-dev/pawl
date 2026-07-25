import { afterAll, describe, expect, test } from "bun:test";
import {
  integrationPrerequisitesMet,
  PAWL_TEST_REPO_A,
  PAWL_TEST_REPO_B,
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
 * Two-repository isolation integration scenarios against a deployed multi-repo
 * stack.
 *
 * Master plan acceptance:
 *   1. events for repository A do not touch repository B's state, and vice versa
 *   2. the reviewer resolves the correct CodeBuild project per PR
 */
const MET = integrationPrerequisitesMet(true);
const REPO_A = PAWL_TEST_REPO_A!;
const REPO_B = PAWL_TEST_REPO_B!;
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

describe.skipIf(!MET)("repository isolation integration (live)", () => {
  test("AC12: a PR on repo A writes state only for repo A; repo B's state is untouched", async () => {
    // Open a PR on repo A.
    const branchA = `test/iso-a-${Date.now()}`;
    const baseA = await headCommit(REPO_A, DEFAULT_BRANCH);
    await createBranch(REPO_A, branchA, baseA);
    await commitFile(REPO_A, branchA, `ISO_A_${Date.now()}.js`, "function f(){ return 1; }\n");
    cleanups.push(async () => deleteBranch(REPO_A, branchA));

    const prA = await createPullRequest(
      REPO_A,
      branchA,
      DEFAULT_BRANCH,
      `[integration] iso A ${Date.now()}`,
      "isolation PR on repo A",
    );
    cleanups.push(async () => closePullRequestSafe(prA.pullRequestId, REPO_A));

    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO_A, requestIdFor(prA.pullRequestId)),
    );

    // Repo A's request key must have state rows.
    const stateA = await readRequestState(STACK.tableName, "codecommit", REPO_A, prA.pullRequestId);
    expect(stateA.length).toBeGreaterThan(0);

    // Repo B's state for repo A's pull-request id must be EMPTY (no shared
    // request id, no leakage). We query repo B's pk with repo A's PR id.
    const stateB = await readRequestState(STACK.tableName, "codecommit", REPO_B, prA.pullRequestId);
    expect(stateB).toHaveLength(0);
  }, 360_000);

  test("AC12: a PR on repo B writes state only for repo B; repo A is untouched", async () => {
    const branchB = `test/iso-b-${Date.now()}`;
    const baseB = await headCommit(REPO_B, DEFAULT_BRANCH);
    await createBranch(REPO_B, branchB, baseB);
    await commitFile(REPO_B, branchB, `ISO_B_${Date.now()}.js`, "function g(){ return 2; }\n");
    cleanups.push(async () => deleteBranch(REPO_B, branchB));

    const prB = await createPullRequest(
      REPO_B,
      branchB,
      DEFAULT_BRANCH,
      `[integration] iso B ${Date.now()}`,
      "isolation PR on repo B",
    );
    cleanups.push(async () => closePullRequestSafe(prB.pullRequestId, REPO_B));

    await waitForExecution(
      STACK.reviewerFunctionName,
      durableExecutionName(REPO_B, requestIdFor(prB.pullRequestId)),
    );

    // Repo B's request key must have state rows.
    const stateB = await readRequestState(STACK.tableName, "codecommit", REPO_B, prB.pullRequestId);
    expect(stateB.length).toBeGreaterThan(0);

    // Repo A's state for repo B's PR id must be EMPTY.
    const stateA = await readRequestState(STACK.tableName, "codecommit", REPO_A, prB.pullRequestId);
    expect(stateA).toHaveLength(0);
  }, 360_000);
});

async function headCommit(repositoryName: string, branchName: string): Promise<string> {
  const result = await codeCommit().send(new GetBranchCommand({ repositoryName, branchName }));
  const commitId = result.branch?.commitId;
  if (!commitId) throw new Error(`no commit id for branch ${branchName}`);
  return commitId;
}

async function closePullRequestSafe(pullRequestId: string, repositoryName: string): Promise<void> {
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
    void repositoryName;
  }
}
