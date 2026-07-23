import { describe, expect, it } from "bun:test";
import {
  findingCandidateSchema,
  findingCategorySchema,
  modelReviewOutputSchema,
  type Finding,
} from "../../../../src/reviewer/domain/finding";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  evaluateDismissalCandidate,
  evaluateFindingCandidate,
  type FindingPolicyContext,
} from "../../../../src/reviewer/domain/review-policy";

const finding = {
  kind: "finding",
  category: "correctness",
  severity: "high",
  confidence: 0.95,
  path: "src/checkout.ts",
  side: "after",
  location: {
    kind: "line",
    line: 18,
    hunkIdentity: "checkout-null-total",
  },
  issueIdentity: "null total reaches arithmetic",
  evidence: "The new optional total is added without a null guard.",
  impact: "Checkout can produce NaN.",
  recommendation: "Guard or default the optional total before addition.",
} as const;

const findingContext: FindingPolicyContext = {
  changedLines: [
    {
      path: finding.path,
      side: finding.side,
      line: finding.location.line,
      hunkIdentity: finding.location.hunkIdentity,
    },
  ],
  introducedHunks: [
    {
      path: finding.path,
      side: finding.side,
      hunkIdentity: "transaction-boundary",
    },
  ],
};

const dismissal = {
  kind: "dismissal",
  findingFingerprint: `review-finding:v1:${"a".repeat(64)}`,
  linkedProviderCommentId: "review-comment-1",
  eligibleHumanCommentId: "human-comment-2",
  rationale: "The linked context identifies an invariant enforced before this call.",
} as const;

const dismissalContext = {
  linkedDismissalByHumanCommentId: new Map([
    [
      dismissal.eligibleHumanCommentId,
      {
        findingFingerprint: dismissal.findingFingerprint,
        linkedProviderCommentId: dismissal.linkedProviderCommentId,
      },
    ],
    [
      "unrelated-human-comment",
      {
        findingFingerprint: `review-finding:v1:${"b".repeat(64)}`,
        linkedProviderCommentId: "review-comment-elsewhere",
      },
    ],
  ]),
};

describe("finding schemas and policy", () => {
  it.each(["correctness", "security", "reliability", "maintainability"])(
    "allows the %s category",
    (category) => expect(findingCategorySchema.parse(category)).toBe(category),
  );

  it.each(["style", "performance", "naming"])("rejects the %s category", (category) => {
    expect(() => findingCategorySchema.parse(category)).toThrow();
  });

  it("makes untrusted candidates unassignable until policy acceptance", () => {
    const candidate = findingCandidateSchema.parse(finding);
    const acceptsFinding = (_accepted: Finding): void => {};

    // @ts-expect-error A model candidate has not crossed the trusted policy boundary.
    acceptsFinding(candidate);

    const evaluation = evaluateFindingCandidate(candidate, findingContext);
    expect(evaluation.accepted).toBe(true);
    if (evaluation.accepted) acceptsFinding(evaluation.value);
  });

  it("requires the high-confidence threshold", () => {
    expect(evaluateFindingCandidate(finding, findingContext).accepted).toBe(true);
    expect(
      evaluateFindingCandidate(
        {
          ...finding,
          confidence: HIGH_CONFIDENCE_THRESHOLD - 0.01,
        },
        findingContext,
      ).accepted,
    ).toBe(false);
  });

  it("accepts only an exact trusted changed-line location", () => {
    expect(evaluateFindingCandidate(finding, findingContext).accepted).toBe(true);
    expect(
      evaluateFindingCandidate({ ...finding, path: "unchanged.ts" }, findingContext).accepted,
    ).toBe(false);
    expect(
      evaluateFindingCandidate(
        {
          ...finding,
          location: { ...finding.location, line: 999 },
        },
        findingContext,
      ).accepted,
    ).toBe(false);
  });

  it("accepts only an exact trusted directly introduced hunk", () => {
    const hunkFinding = {
      ...finding,
      location: {
        kind: "hunk" as const,
        hunkIdentity: "transaction-boundary",
      },
    };

    expect(evaluateFindingCandidate(hunkFinding, findingContext).accepted).toBe(true);
    expect(
      evaluateFindingCandidate(
        {
          ...hunkFinding,
          location: { ...hunkFinding.location, hunkIdentity: "invented-hunk" },
        },
        findingContext,
      ).accepted,
    ).toBe(false);
  });

  it("requires all dismissal fields to match one trusted linkage tuple", () => {
    expect(evaluateDismissalCandidate(dismissal, dismissalContext).accepted).toBe(true);
    expect(
      evaluateDismissalCandidate(
        {
          ...dismissal,
          eligibleHumanCommentId: "unrelated-human-comment",
        },
        dismissalContext,
      ).accepted,
    ).toBe(false);
  });

  it("strictly rejects model attempts to inject trusted fields", () => {
    expect(() =>
      modelReviewOutputSchema.parse({
        candidates: [
          {
            ...finding,
            location: { ...finding.location, changedLine: true },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      modelReviewOutputSchema.parse({
        candidates: [
          {
            ...finding,
            location: {
              kind: "hunk",
              hunkIdentity: "transaction-boundary",
              introducedByChange: true,
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      modelReviewOutputSchema.parse({
        candidates: [{ ...finding, providerCommentId: "forged-comment" }],
      }),
    ).toThrow();
    expect(() =>
      modelReviewOutputSchema.parse({
        candidates: [{ ...dismissal, eligibleHuman: true }],
      }),
    ).toThrow();
  });
});
