import { createHash } from "node:crypto";
import { AwsLambdaTransport, type LambdaTransport } from "./lambda-transport";
import type { ReviewEvent } from "../domain/review-event";
import type { RequestKey, ReviewRequest } from "../domain/review-request";
import type { SourceControlProvider } from "../ports/source-control-provider";
import type {
  ReviewStateStore,
  RemoteExecutionStatus,
  LeaseRecoveryInput,
  CallbackWake,
  FailureOwnership,
} from "../ports/state-store";
import { classifyRetryError, RetryPolicy, type OperationalFailure } from "../services/retry-policy";
import {
  normalizeCodeCommitEvent,
  type CodeCommitEventFilterOptions,
  type NormalizedCodeCommitEvent,
} from "./codecommit-event-normalizer";

export type { LambdaCommand, LambdaTransport } from "./lambda-transport";
export interface EventRouterOptions {
  readonly stateStore: ReviewStateStore;
  readonly lambda?: LambdaTransport;
  readonly provider: SourceControlProvider;
  readonly reviewerFunctionName: string;
  readonly reviewerAlias?: string;
  readonly reviewerArn: string;
  readonly botArnPatterns?: readonly (string | RegExp)[];
  readonly retryPolicy?: RetryPolicy;
  readonly repositoryHash?: (repository: string) => string;
}
export type { CallbackWake } from "../ports/state-store";
export interface RecoveryInput extends Omit<LeaseRecoveryInput, "remoteStatus"> {
  readonly executionArn?: string;
}
export interface RouteResult {
  readonly appended: boolean;
  readonly started: boolean;
  readonly generation: number;
  readonly durableExecutionArn?: string;
}

function hashRepository(repository: string): string {
  return createHash("sha256").update(repository, "utf8").digest("hex").slice(0, 16);
}
export function durableExecutionName(
  provider: string,
  repositoryHash: string,
  request: string,
  generation: number,
): string {
  return `${provider}-${repositoryHash}-${request}-g${generation}`;
}
function isDuplicateExecution(error: unknown): boolean {
  return asRecord(error)?.name === "DurableExecutionAlreadyStartedException";
}
function isNotFound(error: unknown): boolean {
  const name = asRecord(error)?.name;
  return name === "ResourceNotFoundException" || name === "NotFoundException";
}
function isConsumedCallback(error: unknown): boolean {
  const name = asRecord(error)?.name;
  return (
    name === "CallbackAlreadyCompletedException" ||
    name === "CallbackAlreadyConsumedException" ||
    name === "CallbackNotFoundException"
  );
}
function failureFor(operation: string, error: unknown, attempts = 1): OperationalFailure {
  const existing = asRecord(error);
  if (
    existing?.type === "operational-failure" &&
    existing.lifecycleState === "FAILED" &&
    typeof existing.operation === "string" &&
    typeof existing.attempts === "number" &&
    asRecord(existing.lastError) !== undefined
  ) {
    return existing as unknown as OperationalFailure;
  }
  const record = asRecord(error);
  return {
    type: "operational-failure",
    lifecycleState: "FAILED",
    operation,
    reason: classifyRetryError(error) === "permanent" ? "permanent-error" : "retry-exhausted",
    attempts,
    lastError: {
      name:
        typeof record?.name === "string"
          ? record.name
          : error instanceof Error
            ? error.name
            : "UnknownError",
      message:
        typeof record?.message === "string"
          ? record.message
          : error instanceof Error
            ? error.message
            : String(error),
    },
  };
}
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function remoteStatus(value: unknown): RemoteExecutionStatus | undefined {
  const status = text(asRecord(value)?.Status)?.toUpperCase();
  if (status === "RUNNING") return "RUNNING";
  if (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "TIMED_OUT" ||
    status === "STOPPED"
  )
    return status === "SUCCEEDED" ? "SUCCEEDED" : status === "TIMED_OUT" ? "TIMED_OUT" : "FAILED";
  return undefined;
}
function callbackPayload(wake: CallbackWake): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      callbackId: wake.callbackId,
      request: wake.request,
      generation: wake.generation,
      callbackGeneration: wake.callbackGeneration,
      leaseVersion: wake.leaseVersion,
    }),
  );
}

export class EventRouter {
  readonly #store: ReviewStateStore;
  readonly #lambda: LambdaTransport;
  readonly #provider: SourceControlProvider;
  readonly #functionName: string;
  readonly #alias?: string;
  readonly #reviewerArn: string;
  readonly #filters: CodeCommitEventFilterOptions;
  readonly #retry: RetryPolicy;
  readonly #repositoryHash: (repository: string) => string;

  constructor(options: EventRouterOptions) {
    this.#store = options.stateStore;
    this.#lambda = options.lambda ?? new AwsLambdaTransport();
    this.#provider = options.provider;
    this.#functionName = options.reviewerFunctionName;
    this.#alias = options.reviewerAlias;
    this.#reviewerArn = options.reviewerArn;
    this.#filters = {
      reviewerArn: options.reviewerArn,
      botArnPatterns: options.botArnPatterns,
    };
    this.#retry =
      options.retryPolicy ??
      new RetryPolicy({ baseDelayMs: 25, maxDelayMs: 1_000, maxAttempts: 3 });
    this.#repositoryHash = options.repositoryHash ?? hashRepository;
  }

  async route(
    event: ReviewEvent,
    snapshot?: ReviewRequest,
    loadSnapshot?: () => Promise<ReviewRequest>,
  ): Promise<RouteResult> {
    const appended = await this.#store.appendEvent(event);
    try {
      if (appended.callback !== undefined) await this.#wake(appended.callback);
      if (!appended.shouldStart)
        return {
          appended: appended.appended,
          started: false,
          generation: appended.generation,
        };
      const preparedSnapshot =
        snapshot ??
        (loadSnapshot === undefined ? undefined : await this.#retrySnapshot(loadSnapshot));
      const started = await this.#start(
        event.request,
        appended.generation,
        appended.leaseVersion,
        preparedSnapshot,
      );
      return {
        appended: appended.appended,
        started: started !== undefined,
        generation: appended.generation,
        ...(started === undefined ? {} : { durableExecutionArn: started }),
      };
    } catch (error) {
      await this.#completeFailed(
        event.request,
        appended.generation,
        error,
        appended.callback === undefined ? "route" : "callback",
        appended.callback === undefined
          ? {
              kind: "lease",
              leaseVersion: appended.leaseVersion,
            }
          : {
              kind: "callback",
              callbackId: appended.callback.callbackId,
              callbackGeneration: appended.callback.callbackGeneration,
              leaseVersion: appended.callback.leaseVersion,
            },
      );
      return {
        appended: appended.appended,
        started: false,
        generation: appended.generation,
      };
    }
  }

  async routeCodeCommit(value: unknown): Promise<RouteResult | undefined> {
    const normalized = normalizeCodeCommitEvent(value, this.#filters);
    if (normalized === undefined) return undefined;
    const event = this.#reviewEvent(normalized);
    return this.route(event, undefined, () => this.#provider.getRequest(normalized.request));
  }

  async wake(input: CallbackWake): Promise<void> {
    try {
      await this.#wake(input);
    } catch (error) {
      await this.#completeFailed(input.request, input.generation, error, "callback", {
        kind: "callback",
        callbackId: input.callbackId,
        callbackGeneration: input.callbackGeneration,
        leaseVersion: input.leaseVersion,
      });
    }
  }

  async recover(input: RecoveryInput): Promise<RouteResult | undefined> {
    const { executionArn: providedExecutionArn, ...leaseRecovery } = input;
    let remote: RemoteExecutionStatus;
    try {
      const executionArn =
        providedExecutionArn ?? (await this.#lookupExecution(input.request, input.generation));
      remote = executionArn === undefined ? "NOT_FOUND" : await this.#executionStatus(executionArn);
    } catch (error) {
      await this.#completeFailed(input.request, input.generation, error, "status", {
        kind: "lease",
        leaseVersion: input.leaseVersion,
      });
      return undefined;
    }
    const recovery = await this.#store.recoverLease({
      ...leaseRecovery,
      remoteStatus: remote,
    });
    if (!recovery.recovered || !recovery.shouldStart) return undefined;
    let started: string | undefined;
    try {
      started = await this.#start(input.request, recovery.generation, recovery.leaseVersion);
    } catch (error) {
      await this.#completeFailed(input.request, recovery.generation, error, "recovery-start", {
        kind: "lease",
        leaseVersion: recovery.leaseVersion,
        lifecycleState: "STARTING",
      });
      return {
        appended: false,
        started: false,
        generation: recovery.generation,
      };
    }
    return {
      appended: false,
      started: started !== undefined,
      generation: recovery.generation,
      ...(started === undefined ? {} : { durableExecutionArn: started }),
    };
  }

  async #retrySnapshot(load: () => Promise<ReviewRequest>): Promise<ReviewRequest> {
    try {
      const outcome = await this.#retry.execute("provider-refetch", load);
      if (!outcome.ok) throw outcome.failure;
      return outcome.value;
    } catch (error) {
      throw failureFor("provider-refetch", error);
    }
  }

  async #wake(input: CallbackWake): Promise<void> {
    if (!(await this.#store.validateCallback(input))) return;
    try {
      const outcome = await this.#retry.execute("callback", () =>
        this.#lambda.send({
          kind: "callback",
          input: {
            CallbackId: input.callbackId,
            Result: callbackPayload(input),
          },
        }),
      );
      if (!outcome.ok) throw outcome.failure;
    } catch (error) {
      if (isConsumedCallback(error)) return;
      throw error;
    }
  }

  async #start(
    request: RequestKey,
    generation: number,
    leaseVersion: number,
    snapshot?: ReviewRequest,
  ): Promise<string | undefined> {
    const name = durableExecutionName(
      request.provider,
      this.#repositoryHash(request.repository),
      request.requestId,
      generation,
    );
    const payload = new TextEncoder().encode(
      JSON.stringify({
        request,
        generation,
        leaseVersion,
        reviewerArn: this.#reviewerArn,
        ...(snapshot === undefined ? {} : { snapshot }),
      }),
    );
    let result;
    try {
      result = await this.#retry.execute("start", () =>
        this.#lambda.send({
          kind: "invoke",
          input: {
            FunctionName: this.#functionName,
            InvocationType: "Event",
            DurableExecutionName: name,
            Payload: payload,
            ...(this.#alias === undefined ? {} : { Qualifier: this.#alias }),
          },
        }),
      );
    } catch (error) {
      if (!isDuplicateExecution(error)) throw failureFor("start", error);
      const listed = await this.#retry.execute("list", () =>
        this.#lambda.send({
          kind: "list",
          input: {
            FunctionName: this.#functionName,
            ...(this.#alias === undefined ? {} : { Qualifier: this.#alias }),
            DurableExecutionName: name,
          },
        }),
      );
      if (!listed.ok) throw listed.failure;
      const executions = asRecord(listed.value)?.DurableExecutions;
      const match = Array.isArray(executions)
        ? executions.map(asRecord).find((entry) => text(entry?.DurableExecutionName) === name)
        : undefined;
      const arn = text(match?.DurableExecutionArn);
      if (arn === undefined) throw error;
      const status = await this.#executionStatus(arn);
      if (status === "NOT_FOUND") throw new Error("duplicate durable execution disappeared");
      await this.#store.recordExecution(request, generation, arn);
      return arn;
    }
    if (!result.ok) throw result.failure;
    const arn = text(asRecord(result.value)?.DurableExecutionArn);
    if (arn === undefined) throw new Error("durable invocation returned no ARN");
    await this.#store.recordExecution(request, generation, arn);
    return arn;
  }

  async #lookupExecution(request: RequestKey, generation: number): Promise<string | undefined> {
    const name = durableExecutionName(
      request.provider,
      this.#repositoryHash(request.repository),
      request.requestId,
      generation,
    );
    const listed = await this.#retry.execute("list", () =>
      this.#lambda.send({
        kind: "list",
        input: {
          FunctionName: this.#functionName,
          ...(this.#alias === undefined ? {} : { Qualifier: this.#alias }),
          DurableExecutionName: name,
        },
      }),
    );
    if (!listed.ok) throw listed.failure;
    const executions = asRecord(listed.value)?.DurableExecutions;
    const match = Array.isArray(executions)
      ? executions.map(asRecord).find((entry) => text(entry?.DurableExecutionName) === name)
      : undefined;
    return text(match?.DurableExecutionArn);
  }

  async #executionStatus(arn: string): Promise<RemoteExecutionStatus> {
    let result;
    try {
      result = await this.#retry.execute("status", () =>
        this.#lambda.send({
          kind: "status",
          input: { DurableExecutionArn: arn },
        }),
      );
    } catch (error) {
      if (isNotFound(error)) return "NOT_FOUND";
      throw error;
    }
    if (!result.ok) throw result.failure;
    const status = remoteStatus(result.value);
    if (status === undefined) throw new Error("durable execution returned an unknown status");
    return status;
  }

  async #completeFailed(
    request: RequestKey,
    generation: number,
    error: unknown,
    operation: string,
    ownership: FailureOwnership,
  ): Promise<void> {
    try {
      await this.#store.complete(request, generation, {
        type: "failed",
        failure: failureFor(operation, error),
        ownership,
      });
    } catch (error) {
      if (asRecord(error)?.name === "StaleStateError") return;
      throw error;
    }
  }

  #reviewEvent(normalized: NormalizedCodeCommitEvent, snapshot?: ReviewRequest): ReviewEvent {
    if (normalized.type === "revision-updated")
      return {
        id: normalized.id,
        type: normalized.type,
        request: normalized.request,
        occurredAt: normalized.occurredAt,
        revision: snapshot?.sourceRevision ?? normalized.revision!,
      };
    if (normalized.type === "human-comment")
      return {
        id: normalized.id,
        type: normalized.type,
        request: normalized.request,
        occurredAt: normalized.occurredAt,
        commentId: normalized.commentId!,
        ...(normalized.inReplyTo === undefined ? {} : { inReplyTo: normalized.inReplyTo }),
      };
    return {
      id: normalized.id,
      type: normalized.type,
      request: normalized.request,
      occurredAt: normalized.occurredAt,
    };
  }
}

export function createEventRouter(options: EventRouterOptions): EventRouter {
  return new EventRouter(options);
}
