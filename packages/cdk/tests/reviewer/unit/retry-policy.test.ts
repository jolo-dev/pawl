import { describe, expect, it } from "bun:test";
import {
	classifyRetryError,
	RetryPolicy,
	type RetryPolicyOptions,
} from "../../../src/reviewer/services/retry-policy";

const options: RetryPolicyOptions = {
	baseDelayMs: 100,
	maxDelayMs: 1_000,
	maxAttempts: 4,
};

describe("RetryPolicy", () => {
	it("uses exponential delay caps and full jitter", () => {
		const policy = new RetryPolicy({ ...options, random: () => 0.5 });

		expect(policy.delayForAttempt(1)).toBe(50);
		expect(policy.delayForAttempt(2)).toBe(100);
		expect(policy.delayForAttempt(3)).toBe(200);
		expect(policy.delayForAttempt(8)).toBe(500);
	});

	it("keeps full jitter between zero and the bounded maximum", () => {
		expect(
			new RetryPolicy({ ...options, random: () => 0 }).delayForAttempt(20),
		).toBe(0);
		expect(
			new RetryPolicy({ ...options, random: () => 0.999 }).delayForAttempt(20),
		).toBeLessThan(options.maxDelayMs);
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		-0.01,
		1,
	])("rejects an invalid random result %p", (randomResult) => {
		const policy = new RetryPolicy({
			...options,
			random: () => randomResult,
		});

		expect(() => policy.delayForAttempt(1)).toThrow(
			new RangeError("random must return a finite number in [0, 1)"),
		);
	});

	it.each([
		{ name: "ThrottlingException" },
		{ name: "ServiceUnavailableException" },
		{ name: "TimeoutError" },
		{ code: "EAI_AGAIN" },
		{ code: "ECONNRESET" },
		{ $metadata: { httpStatusCode: 503 } },
	])("classifies transient errors as retryable %#", (error) => {
		expect(classifyRetryError(error)).toBe("retryable");
	});

	it.each([
		{ name: "ValidationException" },
		{ name: "AccessDeniedException" },
		{ name: "ResourceNotFoundException" },
		{ $metadata: { httpStatusCode: 401 } },
		{ $metadata: { httpStatusCode: 404 } },
	])("classifies policy errors as permanent %#", (error) => {
		expect(classifyRetryError(error)).toBe("permanent");
	});

	it("does not exceed maximum attempts", async () => {
		let attempts = 0;
		const delays: number[] = [];
		const policy = new RetryPolicy({
			...options,
			random: () => 0.5,
			sleep: (delayMs) => {
				delays.push(delayMs);
				return Promise.resolve();
			},
		});

		const result = await policy.execute("invoke-reviewer", () => {
			attempts += 1;
			throw Object.assign(new Error("throttled"), {
				name: "ThrottlingException",
			});
		});

		expect(attempts).toBe(options.maxAttempts);
		expect(delays).toEqual([50, 100, 200]);
		expect(result).toEqual({
			ok: false,
			failure: {
				type: "operational-failure",
				lifecycleState: "FAILED",
				operation: "invoke-reviewer",
				reason: "retry-exhausted",
				attempts: 4,
				lastError: { name: "ThrottlingException", message: "throttled" },
			},
		});
	});

	it("fails permanent errors immediately", async () => {
		let attempts = 0;
		const error = Object.assign(new Error("forbidden"), {
			name: "AccessDeniedException",
		});
		const policy = new RetryPolicy(options);

		await expect(
			policy.execute("read-config", () => {
				attempts += 1;
				throw error;
			}),
		).rejects.toBe(error);
		expect(attempts).toBe(1);
	});
});
