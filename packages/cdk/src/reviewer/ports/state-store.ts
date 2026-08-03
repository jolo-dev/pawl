import type { Finding, FindingFingerprint } from "../domain/finding";
import type { ReviewEvent } from "../domain/review-event";
import type { RequestKey, ReviewCycleSnapshot } from "../domain/review-request";
import type { OperationalFailure } from "../services/retry-policy";

export type ReviewLifecycleState =
	| "STARTING"
	| "RUNNING"
	| "WAITING"
	| "BLOCKED_LIMIT"
	| "COMPLETED"
	| "TIMED_OUT"
	| "FAILED";

export interface AppendEventResult {
	readonly appended: boolean;
	readonly generation: number;
	readonly leaseVersion: number;
	readonly lifecycleState: ReviewLifecycleState;
	readonly shouldStart: boolean;
	readonly recoveryEligible: boolean;
	readonly callback?: CallbackWake;
}

export interface ClaimedEvents {
	readonly events: readonly ReviewEvent[];
	readonly throughWatermark?: string;
}

export interface FailAndRequeueClaimInput {
	readonly request: RequestKey;
	readonly generation: number;
	readonly leaseVersion: number;
	readonly events: readonly ReviewEvent[];
	readonly failedAt: string;
	readonly failure: OperationalFailure;
}

export type FailAndRequeueClaimResult =
	| { readonly requeued: true; readonly leaseVersion: number }
	| { readonly requeued: false; readonly reason: "changed" };

export interface PipelineClaimRecoveryInput {
	readonly request: RequestKey;
	readonly generation: number;
	readonly leaseVersion: number;
	readonly recoveredAt: string;
}

export type PipelineClaimRecoveryResult =
	| {
			readonly recovered: false;
			readonly reason: "active" | "no-claimed-events";
	  }
	| { readonly recovered: false; readonly reason: "changed" }
	| {
			readonly recovered: true;
			readonly generation: number;
			readonly leaseVersion: number;
	  };

export interface PipelineDispatchIntent {
	readonly request: RequestKey;
	readonly generation: number;
	readonly sourceRevision: string;
	readonly destinationRevision: string;
	readonly observedAt: string;
	readonly eventId: string;
}

export type CompletePipelineDispatchIntentResult =
	| { readonly completed: true }
	| { readonly completed: false; readonly reason: "changed" };

const MAX_PIPELINE_ROUTING_FAILURE_ATTEMPTS = 4;

export function sanitizedPipelineRoutingFailure(
	attempts: number,
): OperationalFailure {
	return {
		type: "operational-failure",
		lifecycleState: "FAILED",
		operation: "pipeline-route",
		reason: "retry-exhausted",
		attempts: Math.max(
			1,
			Math.min(
				MAX_PIPELINE_ROUTING_FAILURE_ATTEMPTS,
				Number.isFinite(attempts) ? Math.trunc(attempts) : 1,
			),
		),
		lastError: {
			name: "PipelineRoutingError",
			message: "Pipeline routing failed",
		},
	};
}

export type RemoteExecutionStatus =
	| "RUNNING"
	| "SUCCEEDED"
	| "FAILED"
	| "TIMED_OUT"
	| "NOT_FOUND";

export interface LeaseRecoveryInput {
	readonly request: RequestKey;
	readonly generation: number;
	readonly leaseVersion: number;
	readonly remoteStatus?: RemoteExecutionStatus;
	readonly recoveredAt: string;
}

export type LeaseRecoveryResult =
	| {
			readonly recovered: false;
			readonly reason:
				| "active"
				| "no-pending-events"
				| "remote-status-required";
	  }
	| {
			readonly recovered: false;
			readonly reason: "changed";
			readonly generation?: number;
			readonly leaseVersion?: number;
	  }
	| {
			readonly recovered: true;
			readonly generation: number;
			readonly leaseVersion: number;
			readonly shouldStart: boolean;
	  };

export interface CallbackGeneration {
	readonly request: RequestKey;
	readonly generation: number;
	readonly callbackGeneration: number;
}

export interface CallbackWake extends CallbackGeneration {
	readonly callbackId: string;
	readonly leaseVersion: number;
}

export interface HeartbeatInput {
	readonly request: RequestKey;
	readonly generation: number;
	readonly leaseVersion: number;
	readonly heartbeatAt: string;
}

export type HeartbeatResult =
	| { readonly renewed: true; readonly leaseVersion: number }
	| { readonly renewed: false; readonly reason: "stale" };

export interface CallbackRegistrationBase extends CallbackGeneration {
	readonly callbackId: string;
	readonly registeredAt: string;
	readonly leaseVersion: number;
}

export type BlockedLimitReason =
	| "max-changed-files"
	| "max-diff-bytes"
	| "max-model-tokens";

export interface BlockedLimitDetail {
	readonly reason: BlockedLimitReason;
	readonly observed: number;
	readonly maximum: number;
}

export type CallbackRegistration = CallbackRegistrationBase &
	(
		| {
				readonly lifecycleState: "WAITING";
				readonly blockedLimit?: never;
		  }
		| {
				readonly lifecycleState: "BLOCKED_LIMIT";
				readonly blockedLimit: BlockedLimitDetail;
		  }
	);

export type CallbackRegistrationResult =
	| { readonly registered: true; readonly hasPendingEvents: boolean }
	| {
			readonly registered: false;
			readonly reason: "stale-generation" | "state-changed";
	  };

export type PersistedFindingStatus =
	| "pending"
	| "open"
	| "resolved"
	| "dismissed";

export interface PersistedFindingIdentity {
	readonly fingerprint: FindingFingerprint;
	readonly category: Finding["category"];
	readonly path: string;
	readonly issueIdentity: string;
}

export interface PersistedFinding extends PersistedFindingIdentity {
	readonly finding: Finding;
	readonly status: PersistedFindingStatus;
	readonly providerCommentId?: string;
	readonly providerContentHash?: string;
	readonly revision: string;
	readonly updatedAt: string;
}

export type FindingWrite =
	| {
			readonly operation: "post";
			readonly request: RequestKey;
			readonly generation: number;
			readonly finding: Finding;
			readonly fingerprint: FindingFingerprint;
			readonly idempotencyToken: string;
	  }
	| {
			readonly operation: "resolve";
			readonly request: RequestKey;
			readonly generation: number;
			readonly fingerprint: FindingFingerprint;
			readonly providerCommentId: string;
			readonly idempotencyToken: string;
			readonly resolution: "fixed" | "dismissed";
			readonly triggeringHumanCommentId?: string;
	  };

export type WriteReservation =
	| { readonly reserved: true; readonly reservationId: string }
	| {
			readonly reserved: false;
			readonly reason:
				| "already-confirmed"
				| "already-reserved"
				| "stale-generation";
			readonly existingProviderCommentId?: string;
	  };

export interface FindingWriteResult {
	readonly request: RequestKey;
	readonly generation: number;
	readonly reservationId: string;
	readonly fingerprint: FindingFingerprint;
	readonly providerCommentId: string;
	readonly providerContentHash: string;
	readonly completedAt: string;
}

export type FailureOwnership =
	| {
			readonly kind: "callback";
			readonly callbackId: string;
			readonly callbackGeneration: number;
			readonly leaseVersion: number;
	  }
	| {
			readonly kind: "lease";
			readonly leaseVersion: number;
			readonly lifecycleState?:
				| "STARTING"
				| "RUNNING"
				| "WAITING"
				| "BLOCKED_LIMIT";
	  };

export type CompletionReason =
	| { readonly type: "clean" }
	| { readonly type: "merged" }
	| { readonly type: "closed" }
	| { readonly type: "timed-out" }
	| {
			readonly type: "failed";
			readonly failure: OperationalFailure;
			readonly ownership: FailureOwnership;
	  };

export interface ReviewStateStore {
	appendEvent(event: ReviewEvent): Promise<AppendEventResult>;
	claimEvents(request: RequestKey, generation: number): Promise<ClaimedEvents>;
	failAndRequeueClaim(
		input: FailAndRequeueClaimInput,
	): Promise<FailAndRequeueClaimResult>;
	recoverOrphanedPipelineClaim(
		input: PipelineClaimRecoveryInput,
	): Promise<PipelineClaimRecoveryResult>;
	getPipelineDispatchIntent(
		request: RequestKey,
		generation: number,
	): Promise<PipelineDispatchIntent | undefined>;
	getOrCreatePipelineDispatchIntent(
		intent: PipelineDispatchIntent,
		leaseVersion: number,
	): Promise<PipelineDispatchIntent>;
	completePipelineDispatchIntent(
		intent: PipelineDispatchIntent,
		leaseVersion: number,
	): Promise<CompletePipelineDispatchIntentResult>;
	recordExecution(
		request: RequestKey,
		generation: number,
		arn: string,
	): Promise<void>;
	recoverLease(input: LeaseRecoveryInput): Promise<LeaseRecoveryResult>;
	heartbeat(input: HeartbeatInput): Promise<HeartbeatResult>;
	validateCallback(input: CallbackWake): Promise<boolean>;
	registerCallback(
		input: CallbackRegistration,
	): Promise<CallbackRegistrationResult>;
	clearCallback(input: CallbackGeneration): Promise<void>;
	beginCycle(snapshot: ReviewCycleSnapshot): Promise<void>;
	listFindings(request: RequestKey): Promise<PersistedFinding[]>;
	reserveFindingWrite(write: FindingWrite): Promise<WriteReservation>;
	confirmFindingWrite(result: FindingWriteResult): Promise<void>;
	complete(
		request: RequestKey,
		generation: number,
		reason: CompletionReason,
	): Promise<void>;
}
