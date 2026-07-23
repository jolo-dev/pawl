import {
  acceptedFindingSchema,
  dismissalCandidateSchema,
  findingCandidateSchema,
  type AcceptedFinding,
  type DismissalCandidate,
  type FindingFingerprint,
  type FindingSide,
} from "./finding";

export const HIGH_CONFIDENCE_THRESHOLD = 0.8;

export type PolicyEvaluation<T> =
  | { readonly accepted: true; readonly value: T }
  | { readonly accepted: false; readonly reason: string };

export interface TrustedChangedLine {
  readonly path: string;
  readonly side: FindingSide;
  readonly line: number;
  readonly hunkIdentity: string;
}

export interface TrustedIntroducedHunk {
  readonly path: string;
  readonly side: FindingSide;
  readonly hunkIdentity: string;
}

export interface FindingPolicyContext {
  readonly changedLines: readonly TrustedChangedLine[];
  readonly introducedHunks: readonly TrustedIntroducedHunk[];
}

export function evaluateFindingCandidate(
  input: unknown,
  context: FindingPolicyContext,
): PolicyEvaluation<AcceptedFinding> {
  const parsed = findingCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return { accepted: false, reason: "invalid-finding-schema" };
  }

  if (parsed.data.confidence < HIGH_CONFIDENCE_THRESHOLD) {
    return { accepted: false, reason: "confidence-below-threshold" };
  }

  const candidateLocation = parsed.data.location;
  const trustedLocation =
    candidateLocation.kind === "line"
      ? context.changedLines.some(
          (location) =>
            location.path === parsed.data.path &&
            location.side === parsed.data.side &&
            location.line === candidateLocation.line &&
            location.hunkIdentity === candidateLocation.hunkIdentity,
        )
      : context.introducedHunks.some(
          (location) =>
            location.path === parsed.data.path &&
            location.side === parsed.data.side &&
            location.hunkIdentity === candidateLocation.hunkIdentity,
        );

  if (!trustedLocation) {
    return { accepted: false, reason: "location-is-not-in-trusted-change" };
  }

  return { accepted: true, value: acceptedFindingSchema.parse(parsed.data) };
}

export interface TrustedDismissalLink {
  readonly findingFingerprint: FindingFingerprint;
  readonly linkedProviderCommentId: string;
}

export interface DismissalPolicyContext {
  readonly linkedDismissalByHumanCommentId: ReadonlyMap<string, TrustedDismissalLink>;
}

export function evaluateDismissalCandidate(
  input: unknown,
  context: DismissalPolicyContext,
): PolicyEvaluation<DismissalCandidate> {
  const parsed = dismissalCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return { accepted: false, reason: "invalid-dismissal-schema" };
  }

  const trustedLink = context.linkedDismissalByHumanCommentId.get(
    parsed.data.eligibleHumanCommentId,
  );
  if (
    trustedLink?.findingFingerprint !== parsed.data.findingFingerprint ||
    trustedLink.linkedProviderCommentId !== parsed.data.linkedProviderCommentId
  ) {
    return { accepted: false, reason: "comment-is-not-linked-to-finding" };
  }

  return { accepted: true, value: parsed.data };
}
