/**
 * Live AWS SDK helpers for the integration tests. All clients read the ambient
 * AWS_PROFILE / AWS_REGION / AWS_* env vars. Tests never pass credentials
 * directly — the operator's environment is the single source of truth.
 */
import { CodeCommitClient } from "@aws-sdk/client-codecommit";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetDurableExecutionCommand,
  LambdaClient,
  ListDurableExecutionsByFunctionCommand,
} from "@aws-sdk/client-lambda";
import {
  CreateBranchCommand,
  CreateCommitCommand,
  CreatePullRequestCommand,
  DeleteBranchCommand,
  GetBranchCommand,
  GetCommentsForPullRequestCommand,
  GetPullRequestCommand,
  ListPullRequestsCommand,
  type CodeCommitClientConfig,
} from "@aws-sdk/client-codecommit";
import { createHash } from "node:crypto";

export interface TestStack {
  readonly tableName: string;
  readonly reviewerFunctionName: string;
  readonly reviewerAlias: string;
}

/** Derive deployed resource names from the team+stage naming convention used
 * by the DurableLambdaReviewerStack (Pawl names resources `${team}-${stage}-...`). */
export function stackResources(team: string, stage: string): TestStack {
  return {
    tableName: `${team}-${stage}-ReviewerState-table`,
    reviewerFunctionName: `${team}-${stage}-Reviewer-lambda`,
    reviewerAlias: "live",
  };
}

export function codeCommit(): CodeCommitClient {
  return new CodeCommitClient({});
}

export function lambda(): LambdaClient {
  return new LambdaClient({});
}

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Build the DynamoDB partition key for a review request (mirrors the store). */
export function requestPk(provider: string, repository: string, requestId: string): string {
  const enc = (s: string) => `v1~${createHash("sha256").update(s, "utf8").digest("base64url")}`;
  return `REQUEST#${enc(provider)}#${enc(repository)}#${enc(requestId)}`;
}

/** Read all rows for a request (pk prefix) — used to assert state in tests. */
export async function readRequestState(
  tableName: string,
  provider: string,
  repository: string,
  requestId: string,
): Promise<Record<string, unknown>[]> {
  const pk = requestPk(provider, repository, requestId);
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    if (result.Items) items.push(...(result.Items as Record<string, unknown>[]));
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return items;
}

/** The deterministic durable-execution name the router assigns (gen 1). */
export function durableExecutionName(repository: string, requestId: string): string {
  const repositoryHash = createHash("sha256").update(repository, "utf8").digest("hex").slice(0, 16);
  return `codecommit-${repositoryHash}-${requestId}-g1`;
}

/** Poll until the durable execution for a request reaches a steady state.
 * The reviewer suspends (WAITING) at a callback after each review cycle, so
 * WAITING is the normal "cycle complete" signal — not a terminal state. We
 * return once the execution is WAITING (comments flushed) or terminal. */
export async function waitForExecution(
  functionName: string,
  executionName: string,
  timeoutMs = 180_000,
  intervalMs = 5_000,
): Promise<{ status: string; arn: string | undefined }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; arn: string | undefined } = { status: "UNKNOWN", arn: undefined };
  // Steady states: WAITING (suspended at a callback = cycle complete) plus the
  // terminal states.
  const steady = new Set(["WAITING", "SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"]);
  while (Date.now() < deadline) {
    try {
      const list = await lambda().send(
        new ListDurableExecutionsByFunctionCommand({
          FunctionName: functionName,
          DurableExecutionName: executionName,
        }),
      );
      const exec = list.DurableExecutions?.[0];
      if (exec?.Status) {
        last = { status: exec.Status, arn: exec.DurableExecutionArn };
        if (steady.has(exec.Status)) {
          // Give comment writes a moment to flush after the cycle completes.
          await sleep(2_000);
          return last;
        }
      }
    } catch {
      // Execution may not exist yet (router hasn't invoked); retry.
    }
    await sleep(intervalMs);
  }
  return last;
}

/** Fetch a durable execution's status by ARN. */
export async function getExecutionStatus(arn: string): Promise<string | undefined> {
  try {
    const result = await lambda().send(
      new GetDurableExecutionCommand({ DurableExecutionArn: arn }),
    );
    return result.Status;
  } catch {
    return undefined;
  }
}

/** Create a branch off the default branch HEAD. */
export async function createBranch(
  repositoryName: string,
  branchName: string,
  commitId: string,
): Promise<void> {
  await codeCommit().send(
    new CreateBranchCommand({
      repositoryName,
      branchName,
      commitId,
    }),
  );
}

/** Delete a branch (best-effort cleanup). */
export async function deleteBranch(repositoryName: string, branchName: string): Promise<void> {
  try {
    await codeCommit().send(new DeleteBranchCommand({ repositoryName, branchName }));
  } catch {
    // Best-effort.
  }
}

/** Commit a file create/update on a branch, returning the new commit id. */
export async function commitFile(
  repositoryName: string,
  branchName: string,
  filePath: string,
  content: string,
): Promise<string> {
  // CodeCommit requires parentCommitId (the current branch HEAD) for commits on
  // an existing branch.
  const branch = await codeCommit().send(new GetBranchCommand({ repositoryName, branchName }));
  const parentCommitId = branch.branch?.commitId;
  if (!parentCommitId) throw new Error(`no commit id for branch ${branchName}`);
  const result = await codeCommit().send(
    new CreateCommitCommand({
      repositoryName,
      branchName,
      parentCommitId,
      putFiles: [{ filePath, fileContent: new TextEncoder().encode(content) }],
    }),
  );
  const commitId = result.commitId;
  if (!commitId) throw new Error("CreateCommit returned no commitId");
  return commitId;
}

/** Open a PR from source → destination. */
export async function createPullRequest(
  repositoryName: string,
  sourceBranch: string,
  destinationBranch: string,
  title: string,
  description: string,
): Promise<{ pullRequestId: string; sourceCommit: string; destinationCommit: string }> {
  const result = await codeCommit().send(
    new CreatePullRequestCommand({
      title,
      description,
      targets: [
        {
          repositoryName,
          sourceReference: sourceBranch,
          destinationReference: destinationBranch,
        },
      ],
    }),
  );
  const pullRequestId = result.pullRequest?.pullRequestId;
  if (!pullRequestId) throw new Error("CreatePullRequest returned no pullRequestId");
  const pr = await getPullRequest(pullRequestId);
  const rel = pr.pullRequestTargets?.[0];
  return {
    pullRequestId,
    sourceCommit: rel?.sourceCommit ?? "",
    destinationCommit: rel?.destinationCommit ?? "",
  };
}

export async function getPullRequest(pullRequestId: string) {
  const result = await codeCommit().send(new GetPullRequestCommand({ pullRequestId }));
  return result.pullRequest!;
}

/** List all comments on a PR (flattened across comment threads). */
export async function listPrComments(
  repositoryName: string,
  pullRequestId: string,
  beforeCommitId: string,
  afterCommitId: string,
): Promise<Array<{ commentId: string; content: string; authorArn?: string }>> {
  const comments: Array<{ commentId: string; content: string; authorArn?: string }> = [];
  let nextToken: string | undefined;
  do {
    const result = await codeCommit().send(
      new GetCommentsForPullRequestCommand({
        repositoryName,
        pullRequestId,
        beforeCommitId,
        afterCommitId,
        nextToken,
      }),
    );
    for (const thread of result.commentsForPullRequestData ?? []) {
      for (const comment of thread.comments ?? []) {
        comments.push({
          commentId: comment.commentId ?? "",
          content: comment.content ?? "",
          authorArn: comment.authorArn,
        });
      }
    }
    nextToken = result.nextToken;
  } while (nextToken);
  return comments;
}

/** List open PRs for a repository (for cleanup). */
export async function listPullRequests(repositoryName: string): Promise<string[]> {
  const ids: string[] = [];
  let nextToken: string | undefined;
  do {
    const result = await codeCommit().send(
      new ListPullRequestsCommand({
        repositoryName,
        pullRequestStatus: "OPEN",
        nextToken,
      }),
    );
    ids.push(...(result.pullRequestIds ?? []));
    nextToken = result.nextToken;
  } while (nextToken);
  return ids;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A unique-ish id for a test request. The router uses the CodeCommit
 * pullRequestId directly as the requestId, so the state key + durable
 * execution name derive from it. */
export function requestIdFor(pullRequestId: string): string {
  return pullRequestId;
}

export type { CodeCommitClientConfig };
