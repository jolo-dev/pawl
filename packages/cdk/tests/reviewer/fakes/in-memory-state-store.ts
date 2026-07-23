import {
  encodeStateKeyComponent,
  PendingWorkError,
  StaleStateError,
} from "../../../src/reviewer/adapters/dynamodb-state-store";
import type { ReviewEvent } from "../../../src/reviewer/domain/review-event";
import type { FindingFingerprint } from "../../../src/reviewer/domain/finding";
import type { RequestKey, ReviewCycleSnapshot } from "../../../src/reviewer/domain/review-request";
import type {
  AppendEventResult,
  BlockedLimitDetail,
  CallbackGeneration,
  CallbackRegistration,
  CallbackRegistrationResult,
  ClaimedEvents,
  CompletionReason,
  FindingWrite,
  FindingWriteResult,
  LeaseRecoveryInput,
  LeaseRecoveryResult,
  HeartbeatInput,
  HeartbeatResult,
  CallbackWake,
  PersistedFinding,
  ReviewLifecycleState,
  ReviewStateStore,
  WriteReservation,
} from "../../../src/reviewer/ports/state-store";

export interface InMemoryStateStoreOptions {
  readonly clock?: () => Date;
  readonly leaseDurationSeconds?: number;
  readonly ttlSeconds?: number;
  readonly afterCallbackPersisted?: () => Promise<void> | void;
}

interface StoredEvent {
  readonly event: ReviewEvent;
  claimedGeneration?: number;
}

interface Reservation {
  readonly id: string;
  readonly write: FindingWrite;
}

interface StoredRequest {
  lifecycleState: ReviewLifecycleState;
  generation: number;
  executionArn?: string;
  callbackId?: string;
  callbackGeneration?: number;
  lastCallbackGeneration?: number;
  blockedLimit?: BlockedLimitDetail;
  leaseVersion: number;
  leaseHeartbeatAt: string;
  leaseExpiresAt: string;
  eventWatermark?: string;
  sourceRevision?: string;
  destinationRevision?: string;
  cycle?: number;
  completionReason?: CompletionReason;
  claimCursor?: string;
  expiresAt: number;
  readonly events: Map<string, StoredEvent>;
  readonly findings: Map<FindingFingerprint, PersistedFinding>;
  readonly reservations: Map<FindingFingerprint, Reservation>;
}

function requestKey(request: RequestKey): string {
  return `REQUEST#${encodeStateKeyComponent(request.provider)}#${encodeStateKeyComponent(request.repository)}#${encodeStateKeyComponent(request.requestId)}`;
}

function eventWatermark(event: ReviewEvent): string {
  return `${new Date(event.occurredAt).toISOString()}#${event.id}`;
}

function eventSortKey(event: ReviewEvent): string {
  return `EVENT#${new Date(event.occurredAt).toISOString()}#${encodeStateKeyComponent(event.id)}`;
}

function compareEvents(left: ReviewEvent, right: ReviewEvent): number {
  const instant = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  return instant === 0 ? left.id.localeCompare(right.id) : instant;
}

export interface InspectedRequestState {
  readonly partitionKey: string;
  readonly lifecycleState: ReviewLifecycleState;
  readonly generation: number;
  readonly leaseVersion: number;
  readonly cycle?: number;
  readonly sourceRevision?: string;
  readonly destinationRevision?: string;
  readonly eventWatermark?: string;
  readonly blockedLimit?: BlockedLimitDetail;
  readonly claimCursor?: string;
  readonly leaseHeartbeatAt: string;
  readonly leaseExpiresAt: string;
  readonly completionReason?: CompletionReason;
  readonly eventSortKeys: readonly string[];
}

export class InMemoryStateStore implements ReviewStateStore {
  readonly #clock: () => Date;
  readonly #leaseDurationSeconds: number;
  readonly #ttlSeconds: number;
  readonly #afterCallbackPersisted?: () => Promise<void> | void;
  readonly #requests = new Map<string, StoredRequest>();

  constructor(options: InMemoryStateStoreOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#leaseDurationSeconds = options.leaseDurationSeconds ?? 300;
    this.#ttlSeconds = options.ttlSeconds ?? 2_592_000;
    this.#afterCallbackPersisted = options.afterCallbackPersisted;
  }

  inspectRequest(request: RequestKey): InspectedRequestState | undefined {
    const partitionKey = requestKey(request);
    const state = this.#requests.get(partitionKey);
    return state
      ? {
          partitionKey,
          lifecycleState: state.lifecycleState,
          generation: state.generation,
          leaseVersion: state.leaseVersion,
          cycle: state.cycle,
          sourceRevision: state.sourceRevision,
          destinationRevision: state.destinationRevision,
          eventWatermark: state.eventWatermark,
          blockedLimit: state.blockedLimit,
          claimCursor: state.claimCursor,
          leaseHeartbeatAt: state.leaseHeartbeatAt,
          leaseExpiresAt: state.leaseExpiresAt,
          completionReason: state.completionReason,
          eventSortKeys: [...state.events.keys()].sort(),
        }
      : undefined;
  }

  async appendEvent(event: ReviewEvent): Promise<AppendEventResult> {
    const key = requestKey(event.request);
    let state = this.#requests.get(key);
    const id = eventSortKey(event);
    if (state?.events.has(id)) {
      return {
        appended: false,
        generation: state.generation,
        leaseVersion: state.leaseVersion,
        lifecycleState: state.lifecycleState,
        shouldStart: false,
        callback:
          state.callbackId && state.callbackGeneration !== undefined
            ? {
                request: event.request,
                generation: state.generation,
                callbackId: state.callbackId,
                callbackGeneration: state.callbackGeneration,
                leaseVersion: state.leaseVersion,
              }
            : undefined,
      };
    }

    let shouldStart = false;
    if (!state) {
      state = this.#newRequest();
      this.#requests.set(key, state);
      shouldStart = true;
    } else if (
      state.lifecycleState === "COMPLETED" ||
      state.lifecycleState === "TIMED_OUT" ||
      state.lifecycleState === "FAILED"
    ) {
      state.generation += 1;
      state.lifecycleState = "STARTING";
      state.executionArn = undefined;
      this.#resetGenerationLocalState(state);
      state.leaseVersion += 1;
      this.#refreshLease(state);
      shouldStart = true;
    }

    state.events.set(id, { event });
    state.claimCursor = undefined;
    state.expiresAt = this.#epochSeconds() + this.#ttlSeconds;
    const callback =
      state.callbackId !== undefined && state.callbackGeneration !== undefined
        ? {
            request: event.request,
            generation: state.generation,
            callbackId: state.callbackId,
            callbackGeneration: state.callbackGeneration,
            leaseVersion: state.leaseVersion,
          }
        : undefined;
    return {
      appended: true,
      generation: state.generation,
      leaseVersion: state.leaseVersion,
      lifecycleState: state.lifecycleState,
      shouldStart,
      callback,
    };
  }

  async claimEvents(request: RequestKey, generation: number): Promise<ClaimedEvents> {
    const state = this.#requireRequest(request);
    this.#requireGeneration(state, generation);
    if (
      state.lifecycleState === "COMPLETED" ||
      state.lifecycleState === "TIMED_OUT" ||
      state.lifecycleState === "FAILED"
    ) {
      throw new Error("cannot claim events from a completed generation");
    }

    const claimed = [...state.events.values()]
      .filter((entry) => entry.claimedGeneration === undefined)
      .sort((left, right) => compareEvents(left.event, right.event))
      .slice(0, 99);
    for (const entry of claimed) entry.claimedGeneration = generation;
    const hasRemainingEvents = [...state.events.values()].some(
      ({ claimedGeneration }) => claimedGeneration === undefined,
    );
    state.claimCursor =
      claimed.length === 99 && hasRemainingEvents ? eventSortKey(claimed.at(-1)!.event) : undefined;
    if (claimed.length > 0) {
      const watermark = eventWatermark(claimed.at(-1)!.event);
      if (state.eventWatermark === undefined || watermark > state.eventWatermark) {
        state.eventWatermark = watermark;
      }
      state.lifecycleState = "RUNNING";
      state.callbackId = undefined;
      state.callbackGeneration = undefined;
      state.blockedLimit = undefined;
      this.#refreshLease(state);
    }
    return {
      events: claimed.map(({ event }) => event),
      throughWatermark: claimed.length > 0 ? state.eventWatermark : undefined,
    };
  }

  async recordExecution(request: RequestKey, generation: number, arn: string): Promise<void> {
    const state = this.#requireRequest(request);
    this.#requireGeneration(state, generation);
    if (state.lifecycleState !== "STARTING" || state.executionArn !== undefined) {
      throw new Error("execution ownership changed");
    }
    state.executionArn = arn;
    state.lifecycleState = "RUNNING";
    this.#refreshLease(state);
  }

  async recoverLease(input: LeaseRecoveryInput): Promise<LeaseRecoveryResult> {
    const recoveredAt = new Date(input.recoveredAt).toISOString();
    const state = this.#requests.get(requestKey(input.request));
    if (
      !state ||
      state.generation !== input.generation ||
      state.leaseVersion !== input.leaseVersion
    ) {
      return { recovered: false, reason: "changed" };
    }
    if (state.leaseExpiresAt > recoveredAt) {
      return { recovered: false, reason: "active" };
    }
    if (input.remoteStatus === "RUNNING") {
      return { recovered: false, reason: "active" };
    }
    const pending = [...state.events.values()].some(
      ({ claimedGeneration }) => claimedGeneration === undefined,
    );
    if (!pending) return { recovered: false, reason: "no-pending-events" };

    const isStarting = state.lifecycleState === "STARTING";
    if (isStarting) {
      if (state.executionArn !== undefined) {
        return { recovered: false, reason: "active" };
      }
      if (input.remoteStatus !== "NOT_FOUND") {
        return { recovered: false, reason: "changed" };
      }
    } else if (
      state.lifecycleState === "RUNNING" ||
      state.lifecycleState === "WAITING" ||
      state.lifecycleState === "BLOCKED_LIMIT"
    ) {
      state.generation += 1;
    } else {
      return { recovered: false, reason: "changed" };
    }

    state.lifecycleState = "STARTING";
    state.executionArn = undefined;
    state.callbackId = undefined;
    state.callbackGeneration = undefined;
    if (!isStarting) this.#resetGenerationLocalState(state);
    state.leaseVersion += 1;
    this.#refreshLease(state, recoveredAt);
    return {
      recovered: true,
      generation: state.generation,
      leaseVersion: state.leaseVersion,
      shouldStart: true,
    };
  }

  async heartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
    const heartbeatAt = new Date(input.heartbeatAt).toISOString();
    const state = this.#requests.get(requestKey(input.request));
    if (
      !state ||
      state.generation !== input.generation ||
      state.leaseVersion !== input.leaseVersion ||
      !["RUNNING", "WAITING", "BLOCKED_LIMIT"].includes(state.lifecycleState) ||
      state.leaseExpiresAt <= heartbeatAt ||
      state.leaseHeartbeatAt >= heartbeatAt
    )
      return { renewed: false, reason: "stale" };
    state.leaseHeartbeatAt = heartbeatAt;
    state.leaseExpiresAt = this.#leaseExpiry(heartbeatAt);
    state.leaseVersion += 1;
    return { renewed: true, leaseVersion: state.leaseVersion };
  }

  async validateCallback(input: CallbackWake): Promise<boolean> {
    const state = this.#requests.get(requestKey(input.request));
    return (
      state !== undefined &&
      state.generation === input.generation &&
      state.callbackId === input.callbackId &&
      state.callbackGeneration === input.callbackGeneration &&
      state.leaseVersion === input.leaseVersion &&
      (state.lifecycleState === "RUNNING" ||
        state.lifecycleState === "WAITING" ||
        state.lifecycleState === "BLOCKED_LIMIT") &&
      state.leaseExpiresAt > this.#clock().toISOString()
    );
  }

  async registerCallback(input: CallbackRegistration): Promise<CallbackRegistrationResult> {
    const registeredAt = new Date(input.registeredAt).toISOString();
    const state = this.#requests.get(requestKey(input.request));
    if (!state || state.generation !== input.generation) {
      return { registered: false, reason: "stale-generation" };
    }
    const replaceable =
      state.lastCallbackGeneration === undefined ||
      input.callbackGeneration > state.lastCallbackGeneration;
    if (
      !replaceable ||
      input.leaseVersion !== state.leaseVersion ||
      state.leaseExpiresAt <= registeredAt ||
      state.leaseHeartbeatAt > registeredAt ||
      (state.lifecycleState !== "RUNNING" &&
        state.lifecycleState !== "WAITING" &&
        state.lifecycleState !== "BLOCKED_LIMIT")
    ) {
      return { registered: false, reason: "state-changed" };
    }
    state.callbackId = input.callbackId;
    state.callbackGeneration = input.callbackGeneration;
    state.lastCallbackGeneration = input.callbackGeneration;
    state.lifecycleState = input.lifecycleState;
    state.blockedLimit = input.lifecycleState === "BLOCKED_LIMIT" ? input.blockedLimit : undefined;
    this.#refreshLease(state, registeredAt);

    await this.#afterCallbackPersisted?.();
    return { registered: true, hasPendingEvents: this.#hasPending(state) };
  }

  async clearCallback(input: CallbackGeneration): Promise<void> {
    const state = this.#requireRequest(input.request);
    if (
      state.generation !== input.generation ||
      state.callbackGeneration !== input.callbackGeneration
    ) {
      throw new Error("stale callback generation");
    }
    state.callbackId = undefined;
    state.callbackGeneration = undefined;
    state.blockedLimit = undefined;
  }

  async beginCycle(snapshot: ReviewCycleSnapshot): Promise<void> {
    const state = this.#requireRequest(snapshot.request);
    this.#requireGeneration(state, snapshot.generation);
    if (state.lifecycleState !== "RUNNING" && state.lifecycleState !== "WAITING") {
      throw new StaleStateError();
    }
    if (state.cycle !== undefined && snapshot.cycle <= state.cycle) {
      throw new Error("cycle must increase monotonically");
    }
    state.sourceRevision = snapshot.sourceRevision;
    state.destinationRevision = snapshot.destinationRevision;
    state.cycle = snapshot.cycle;
    state.lifecycleState = "RUNNING";
    this.#refreshLease(state, snapshot.startedAt);
  }

  async listFindings(request: RequestKey): Promise<PersistedFinding[]> {
    const state = this.#requests.get(requestKey(request));
    return state ? [...state.findings.values()] : [];
  }

  async reserveFindingWrite(write: FindingWrite): Promise<WriteReservation> {
    const state = this.#requests.get(requestKey(write.request));
    if (!state || state.generation !== write.generation) {
      return { reserved: false, reason: "stale-generation" };
    }
    const existing = state.findings.get(write.fingerprint);
    const reservation = state.reservations.get(write.fingerprint);
    if (reservation?.write.generation === write.generation) {
      return reservation.write.idempotencyToken === write.idempotencyToken
        ? { reserved: true, reservationId: reservation.id }
        : { reserved: false, reason: "already-reserved" };
    }
    if (
      existing &&
      ((write.operation === "post" && existing.status !== "pending") ||
        (write.operation === "resolve" && existing.status !== "open"))
    ) {
      return {
        reserved: false,
        reason: "already-confirmed",
        existingProviderCommentId: existing.providerCommentId,
      };
    }
    if (write.operation === "resolve" && !existing) {
      return { reserved: false, reason: "already-confirmed" };
    }

    const reservationId = `${write.generation}:${write.idempotencyToken}`;
    state.reservations.set(write.fingerprint, { id: reservationId, write });
    if (write.operation === "post") {
      state.findings.set(write.fingerprint, {
        fingerprint: write.fingerprint,
        category: write.finding.category,
        path: write.finding.path,
        issueIdentity: write.finding.issueIdentity,
        finding: write.finding,
        status: "pending",
        revision: state.sourceRevision ?? "unknown",
        updatedAt: this.#clock().toISOString(),
      });
    }
    return { reserved: true, reservationId };
  }

  async confirmFindingWrite(result: FindingWriteResult): Promise<void> {
    const state = this.#requireRequest(result.request);
    this.#requireGeneration(state, result.generation);
    const reservation = state.reservations.get(result.fingerprint);
    if (!reservation || reservation.id !== result.reservationId) {
      throw new Error("finding reservation changed");
    }

    if (reservation.write.operation === "post") {
      const write = reservation.write;
      state.findings.set(result.fingerprint, {
        fingerprint: result.fingerprint,
        category: write.finding.category,
        path: write.finding.path,
        issueIdentity: write.finding.issueIdentity,
        finding: write.finding,
        status: "open",
        providerCommentId: result.providerCommentId,
        providerContentHash: result.providerContentHash,
        revision: state.sourceRevision ?? "unknown",
        updatedAt: result.completedAt,
      });
    } else {
      const existing = state.findings.get(result.fingerprint);
      if (!existing) throw new Error("finding no longer exists");
      state.findings.set(result.fingerprint, {
        ...existing,
        status: reservation.write.resolution === "fixed" ? "resolved" : "dismissed",
        providerCommentId: result.providerCommentId,
        providerContentHash: result.providerContentHash,
        updatedAt: result.completedAt,
      });
    }
    state.reservations.delete(result.fingerprint);
  }

  async complete(request: RequestKey, generation: number, reason: CompletionReason): Promise<void> {
    const state = this.#requireRequest(request);
    this.#requireGeneration(state, generation);
    if (
      state.lifecycleState !== "RUNNING" &&
      state.lifecycleState !== "WAITING" &&
      state.lifecycleState !== "BLOCKED_LIMIT" &&
      !(reason.type === "failed" && state.lifecycleState === "STARTING")
    ) {
      throw new StaleStateError();
    }
    if (reason.type === "failed") {
      const ownership = reason.ownership;
      if (state.leaseVersion !== ownership.leaseVersion) {
        throw new StaleStateError();
      }
      if (
        ownership.kind === "callback" &&
        (state.callbackId !== ownership.callbackId ||
          state.callbackGeneration !== ownership.callbackGeneration)
      ) {
        throw new StaleStateError();
      }
      if (
        ownership.kind === "lease" &&
        ownership.lifecycleState !== undefined &&
        state.lifecycleState !== ownership.lifecycleState
      ) {
        throw new StaleStateError();
      }
    }
    if (this.#hasPending(state) && reason.type !== "failed") throw new PendingWorkError();
    state.lifecycleState =
      reason.type === "timed-out" ? "TIMED_OUT" : reason.type === "failed" ? "FAILED" : "COMPLETED";
    state.completionReason = reason;
    state.executionArn = undefined;
    state.callbackId = undefined;
    state.callbackGeneration = undefined;
    state.blockedLimit = undefined;
    state.expiresAt = this.#epochSeconds() + this.#ttlSeconds;
  }

  #resetGenerationLocalState(state: StoredRequest): void {
    state.executionArn = undefined;
    state.callbackId = undefined;
    state.callbackGeneration = undefined;
    state.lastCallbackGeneration = undefined;
    state.blockedLimit = undefined;
    state.sourceRevision = undefined;
    state.destinationRevision = undefined;
    state.cycle = undefined;
    state.eventWatermark = undefined;
    state.completionReason = undefined;
    state.claimCursor = undefined;
  }

  #newRequest(): StoredRequest {
    const now = this.#clock().toISOString();
    return {
      lifecycleState: "STARTING",
      generation: 1,
      leaseVersion: 1,
      leaseHeartbeatAt: now,
      leaseExpiresAt: this.#leaseExpiry(now),
      expiresAt: this.#epochSeconds() + this.#ttlSeconds,
      events: new Map(),
      findings: new Map(),
      reservations: new Map(),
    };
  }

  #requireRequest(request: RequestKey): StoredRequest {
    const state = this.#requests.get(requestKey(request));
    if (!state) throw new Error("review request state does not exist");
    return state;
  }

  #requireGeneration(state: StoredRequest, generation: number): void {
    if (state.generation !== generation) throw new Error("stale generation");
  }

  #hasPending(state: StoredRequest): boolean {
    return [...state.events.values()].some(
      ({ claimedGeneration }) => claimedGeneration === undefined,
    );
  }

  #refreshLease(state: StoredRequest, heartbeat = this.#clock().toISOString()): void {
    state.leaseHeartbeatAt = heartbeat;
    state.leaseExpiresAt = this.#leaseExpiry(heartbeat);
  }

  #leaseExpiry(heartbeat: string): string {
    return new Date(Date.parse(heartbeat) + this.#leaseDurationSeconds * 1_000).toISOString();
  }

  #epochSeconds(): number {
    return Math.floor(this.#clock().getTime() / 1_000);
  }
}
