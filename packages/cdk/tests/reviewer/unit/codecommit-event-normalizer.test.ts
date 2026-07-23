import { expect, test } from "bun:test";
import { normalizeCodeCommitEvent } from "../../../src/reviewer/router/codecommit-event-normalizer";

test("normalizes native request, revision, comment, and closed events without bodies", () => {
  const base = {
    id: "event-1",
    time: "2026-01-01T00:00:00.000Z",
    "detail-type": "CodeCommit Pull Request State Change",
    source: "aws.codecommit",
    detail: {
      pullRequestId: "7",
      repositoryNames: ["repo"],
      event: "pullRequestCreated",
      pullRequestStatus: "Open",
      sourceCommit: "source-123",
      destinationCommit: "dest-123",
      callerUserArn: "human",
    },
  };
  expect(normalizeCodeCommitEvent(base)?.type).toBe("request-opened");
  expect(
    normalizeCodeCommitEvent({
      ...base,
      id: "event-2",
      detail: { ...base.detail, event: "pullRequestSourceBranchUpdated" },
    })?.type,
  ).toBe("revision-updated");
  expect(
    normalizeCodeCommitEvent({
      ...base,
      id: "event-3",
      "detail-type": "CodeCommit Comment on Pull Request",
      detail: {
        ...base.detail,
        commentId: "comment-1",
        event: "commentOnPullRequestCreated",
        notificationBody: "must-not-persist",
      },
    })?.type,
  ).toBe("human-comment");
  expect(JSON.stringify(normalizeCodeCommitEvent(base))).not.toContain("must-not-persist");
  expect(
    normalizeCodeCommitEvent({
      ...base,
      id: "event-4",
      detail: {
        ...base.detail,
        event: "pullRequestStatusChanged",
        pullRequestStatus: "Closed",
      },
    })?.type,
  ).toBe("request-closed");
});

test("maps reopened pull requests to request-opened", () => {
  const normalized = normalizeCodeCommitEvent({
    id: "event-reopened",
    time: "2026-01-01T00:00:00.000Z",
    source: "aws.codecommit",
    "detail-type": "CodeCommit Pull Request State Change",
    detail: {
      repositoryName: "repo",
      pullRequestId: "7",
      event: "pullRequestStatusChanged",
      pullRequestStatus: "OPEN",
    },
  });

  expect(normalized?.type).toBe("request-opened");
});

test("normalizes documented CloudTrail merge fallback names without persisting bodies", () => {
  const normalized = normalizeCodeCommitEvent({
    eventID: "cloudtrail-merge",
    eventTime: "2026-01-01T00:00:00.000Z",
    eventSource: "codecommit.amazonaws.com",
    eventName: "UpdatePullRequestStatus",
    userIdentity: { arn: "arn:human" },
    requestParameters: {
      pullRequestId: "7",
      repositoryName: "repo",
      pullRequestStatus: "CLOSED",
      isMerged: true,
      notificationBody: "secret",
    },
  });
  expect(normalized?.type).toBe("request-merged");
  expect(normalized?.id).toBe("cloudtrail-merge");
  expect(JSON.stringify(normalized)).not.toContain("secret");
});

test("filters reviewer and bot events and retains provider event IDs", () => {
  const event = {
    id: "provider-event",
    time: "2026-01-01T00:00:00.000Z",
    "detail-type": "CodeCommit Comment on Pull Request",
    source: "aws.codecommit",
    detail: {
      pullRequestId: "7",
      repositoryName: "repo",
      commentId: "c",
      callerUserArn: "arn:bot",
    },
  };
  expect(normalizeCodeCommitEvent(event, { reviewerArn: "arn:bot" })).toBeUndefined();
  expect(normalizeCodeCommitEvent(event, { botArnPatterns: ["arn:bot"] })).toBeUndefined();
  expect(
    normalizeCodeCommitEvent({
      ...event,
      detail: { ...event.detail, callerUserArn: "arn:human" },
    })?.id,
  ).toBe("provider-event");
});

test("applies global bot patterns deterministically across repeated events", () => {
  const event = {
    id: "provider-event",
    time: "2026-01-01T00:00:00.000Z",
    "detail-type": "CodeCommit Comment on Pull Request",
    source: "aws.codecommit",
    detail: {
      pullRequestId: "7",
      repositoryName: "repo",
      commentId: "c",
      event: "commentOnPullRequestCreated",
      callerUserArn: "arn:aws:iam::123456789012:role/reviewer-bot",
    },
  };
  const botPattern = /reviewer-bot/g;

  expect(normalizeCodeCommitEvent(event, { botArnPatterns: [botPattern] })).toBeUndefined();
  expect(normalizeCodeCommitEvent(event, { botArnPatterns: [botPattern] })).toBeUndefined();
});

test("normalizes nested CloudTrail metadata instead of envelope metadata", () => {
  const normalized = normalizeCodeCommitEvent({
    id: "envelope-id",
    time: "2026-01-01T00:00:09.000Z",
    source: "aws.codecommit",
    "detail-type": "AWS API Call via CloudTrail",
    detail: {
      eventID: "nested-merge",
      eventTime: "2026-01-01T00:00:00.000Z",
      eventSource: "codecommit.amazonaws.com",
      eventName: "UpdatePullRequestStatus",
      userIdentity: { arn: "arn:human" },
      requestParameters: {
        repositoryName: "nested/repo",
        pullRequestId: "9",
        pullRequestStatus: "CLOSED",
        isMerged: true,
        sourceReference: "refs/heads/feature",
        notificationBody: "secret",
      },
    },
  });
  expect(normalized).toMatchObject({
    id: "nested-merge",
    occurredAt: "2026-01-01T00:00:00.000Z",
    request: {
      provider: "codecommit",
      repository: "repo",
      requestId: "9",
    },
    type: "request-merged",
  });
  expect(JSON.stringify(normalized)).not.toContain("secret");
});

test("rejects malformed timestamps without throwing", () => {
  expect(
    normalizeCodeCommitEvent({
      id: "bad-time",
      time: "not-a-date",
      source: "aws.codecommit",
      "detail-type": "CodeCommit Pull Request State Change",
      detail: {
        repositoryName: "repo",
        pullRequestId: "7",
        event: "pullRequestCreated",
      },
    }),
  ).toBeUndefined();
});

test("rejects normalized events outside domain bounds", () => {
  expect(
    normalizeCodeCommitEvent({
      id: "x".repeat(513),
      time: "2026-01-01T00:00:00.000Z",
      source: "aws.codecommit",
      "detail-type": "CodeCommit Pull Request State Change",
      detail: {
        repositoryName: "repo",
        pullRequestId: "7",
        event: "pullRequestCreated",
      },
    }),
  ).toBeUndefined();
  expect(
    normalizeCodeCommitEvent({
      id: "short-revision",
      time: "2026-01-01T00:00:00.000Z",
      source: "aws.codecommit",
      "detail-type": "CodeCommit Pull Request State Change",
      detail: {
        repositoryName: "repo",
        pullRequestId: "7",
        event: "pullRequestSourceBranchUpdated",
        sourceCommit: "short",
      },
    }),
  ).toBeUndefined();
});

test("normalizes replies without persisting their body", () => {
  const normalized = normalizeCodeCommitEvent({
    id: "reply-event",
    time: "2026-01-01T00:00:00.000Z",
    source: "aws.codecommit",
    "detail-type": "CodeCommit Comment on Pull Request",
    detail: {
      repositoryName: "repo",
      pullRequestId: "7",
      commentId: "reply-1",
      inReplyTo: "parent-1",
      event: "commentOnPullRequestCreated",
      notificationBody: "secret body",
    },
  });
  expect(normalized).toMatchObject({
    type: "human-comment",
    commentId: "reply-1",
    inReplyTo: "parent-1",
  });
  expect(JSON.stringify(normalized)).not.toContain("secret body");
});

test("normalizes wrapped CloudTrail comments and filters their nested actor", () => {
  const event = {
    version: "0",
    id: "eventbridge-cloudtrail-comment",
    time: "2026-01-01T00:00:01.000Z",
    "detail-type": "AWS API Call via CloudTrail",
    source: "aws.codecommit",
    detail: {
      eventID: "cloudtrail-comment",
      eventTime: "2026-01-01T00:00:00.000Z",
      eventSource: "codecommit.amazonaws.com",
      eventName: "PostCommentForPullRequest",
      userIdentity: { arn: "arn:human" },
      requestParameters: {
        repositoryName: "repo",
        pullRequestId: "7",
        content: "secret body",
      },
      responseElements: {
        comment: {
          commentId: "comment-7",
          inReplyTo: "parent-1",
        },
      },
    },
  };

  expect(normalizeCodeCommitEvent(event)).toMatchObject({
    id: "cloudtrail-comment",
    occurredAt: "2026-01-01T00:00:00.000Z",
    type: "human-comment",
    commentId: "comment-7",
    inReplyTo: "parent-1",
    request: { repository: "repo", requestId: "7" },
  });
  expect(JSON.stringify(normalizeCodeCommitEvent(event))).not.toContain("secret body");
  expect(normalizeCodeCommitEvent(event, { reviewerArn: "arn:human" })).toBeUndefined();
  expect(normalizeCodeCommitEvent(event, { botArnPatterns: [/arn:human/g] })).toBeUndefined();
});

test("rejects unrelated native and CloudTrail provenance", () => {
  expect(
    normalizeCodeCommitEvent({
      id: "native-id",
      time: "2026-01-01T00:00:00.000Z",
      source: "aws.s3",
      "detail-type": "CodeCommit Pull Request State Change",
      detail: {
        repositoryName: "repo",
        pullRequestId: "7",
        event: "pullRequestCreated",
      },
    }),
  ).toBeUndefined();
  const cloudTrailDetail = {
    eventID: "provider-id",
    eventTime: "2026-01-01T00:00:00.000Z",
    eventSource: "codecommit.amazonaws.com",
    eventName: "PostCommentForPullRequest",
    requestParameters: { repositoryName: "repo", pullRequestId: "7" },
    responseElements: { comment: { commentId: "comment" } },
  };
  expect(
    normalizeCodeCommitEvent({
      id: "envelope",
      time: "2026-01-01T00:00:01.000Z",
      source: "aws.codecommit",
      "detail-type": "AWS API Call via CloudTrail",
      detail: { ...cloudTrailDetail, eventSource: "s3.amazonaws.com" },
    }),
  ).toBeUndefined();
  expect(
    normalizeCodeCommitEvent({
      id: "envelope",
      time: "2026-01-01T00:00:01.000Z",
      source: "aws.s3",
      "detail-type": "AWS API Call via CloudTrail",
      detail: cloudTrailDetail,
    }),
  ).toBeUndefined();
});
