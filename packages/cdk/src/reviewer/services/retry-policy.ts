export type RetryClassification = "retryable" | "permanent";

export interface RetryPolicyOptions {
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
	readonly maxAttempts: number;
	readonly random?: () => number;
	readonly sleep?: (delayMs: number) => Promise<void>;
}

export interface SerializedOperationalError {
	readonly name: string;
	readonly message: string;
}

export interface OperationalFailure {
	readonly type: "operational-failure";
	readonly lifecycleState: "FAILED";
	readonly operation: string;
	readonly reason: "retry-exhausted" | "permanent-error";
	readonly attempts: number;
	readonly lastError: SerializedOperationalError;
}

export type RetryResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly failure: OperationalFailure };

const RETRYABLE_NAMES = new Set([
	"AbortError",
	"InternalFailure",
	"InternalServerException",
	"PriorRequestNotComplete",
	"RequestTimeout",
	"RequestTimeoutException",
	"ServiceUnavailable",
	"ServiceUnavailableException",
	"ThrottledException",
	"Throttling",
	"ThrottlingException",
	"TimeoutError",
	"TooManyRequestsException",
]);

const PERMANENT_NAMES = new Set([
	"AccessDeniedException",
	"ExpiredTokenException",
	"InvalidParameterException",
	"InvalidSignatureException",
	"NotAuthorizedException",
	"ResourceNotFoundException",
	"UnauthorizedException",
	"UnrecognizedClientException",
	"ValidationException",
]);

const RETRYABLE_CODES = new Set([
	"EAI_AGAIN",
	"ECONNABORTED",
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETDOWN",
	"ENETUNREACH",
	"EPIPE",
	"ETIMEDOUT",
]);

function asRecord(
	value: unknown,
): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

function stringField(
	record: Readonly<Record<string, unknown>>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function statusCode(
	error: Readonly<Record<string, unknown>>,
): number | undefined {
	const direct = error.statusCode;
	if (typeof direct === "number") return direct;
	const metadata = asRecord(error.$metadata);
	const metadataStatus = metadata?.httpStatusCode;
	return typeof metadataStatus === "number" ? metadataStatus : undefined;
}

export function classifyRetryError(error: unknown): RetryClassification {
	const record = asRecord(error);
	if (!record) return "permanent";

	const name = stringField(record, "name");
	const code = stringField(record, "code");
	if (
		(name && PERMANENT_NAMES.has(name)) ||
		(code && PERMANENT_NAMES.has(code))
	) {
		return "permanent";
	}
	if (
		(name && RETRYABLE_NAMES.has(name)) ||
		(code && RETRYABLE_CODES.has(code))
	) {
		return "retryable";
	}

	const status = statusCode(record);
	if (
		status === 408 ||
		status === 429 ||
		(status !== undefined && status >= 500)
	) {
		return "retryable";
	}
	return "permanent";
}

function serializeError(error: unknown): SerializedOperationalError {
	if (error instanceof Error) {
		return { name: error.name, message: error.message };
	}
	const record = asRecord(error);
	return {
		name: record
			? (stringField(record, "name") ?? "UnknownError")
			: "UnknownError",
		message: record
			? (stringField(record, "message") ?? String(error))
			: String(error),
	};
}

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class RetryPolicy {
	readonly #baseDelayMs: number;
	readonly #maxDelayMs: number;
	readonly #maxAttempts: number;
	readonly #random: () => number;
	readonly #sleep: (delayMs: number) => Promise<void>;

	constructor(options: RetryPolicyOptions) {
		if (!Number.isFinite(options.baseDelayMs) || options.baseDelayMs < 0) {
			throw new RangeError("baseDelayMs must be a non-negative finite number");
		}
		if (
			!Number.isFinite(options.maxDelayMs) ||
			options.maxDelayMs < options.baseDelayMs
		) {
			throw new RangeError(
				"maxDelayMs must be finite and at least baseDelayMs",
			);
		}
		if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
			throw new RangeError("maxAttempts must be a positive integer");
		}

		this.#baseDelayMs = options.baseDelayMs;
		this.#maxDelayMs = options.maxDelayMs;
		this.#maxAttempts = options.maxAttempts;
		this.#random = options.random ?? Math.random;
		this.#sleep = options.sleep ?? defaultSleep;
	}

	get maxAttempts(): number {
		return this.#maxAttempts;
	}

	delayForAttempt(attempt: number): number {
		if (!Number.isInteger(attempt) || attempt < 1) {
			throw new RangeError("attempt must be a positive integer");
		}
		const exponentialCap = Math.min(
			this.#maxDelayMs,
			this.#baseDelayMs * 2 ** Math.min(attempt - 1, 52),
		);
		const jitter = this.#random();
		if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) {
			throw new RangeError("random must return a finite number in [0, 1)");
		}
		return Math.floor(exponentialCap * jitter);
	}

	async execute<T>(
		operation: string,
		run: () => Promise<T> | T,
	): Promise<RetryResult<T>> {
		for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
			try {
				return { ok: true, value: await run() };
			} catch (error) {
				if (classifyRetryError(error) === "permanent") throw error;
				if (attempt === this.#maxAttempts) {
					return {
						ok: false,
						failure: {
							type: "operational-failure",
							lifecycleState: "FAILED",
							operation,
							reason: "retry-exhausted",
							attempts: attempt,
							lastError: serializeError(error),
						},
					};
				}
				await this.#sleep(this.delayForAttempt(attempt));
			}
		}

		throw new Error("retry loop terminated unexpectedly");
	}
}
