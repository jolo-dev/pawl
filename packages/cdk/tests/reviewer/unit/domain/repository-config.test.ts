import { describe, expect, it } from "bun:test";
import {
	REPOSITORY_CONFIG_LIMITS,
	repositoryConfigSchema,
} from "../../../../src/reviewer/domain/repository-config";

describe("repositoryConfigSchema", () => {
	it("applies safe defaults, including event debounce", () => {
		const config = repositoryConfigSchema.parse({ version: 1 });

		expect(config.checks).toEqual([]);
		expect(config.review).toEqual({
			debounceSeconds: 5,
			maxChangedFiles: 100,
			maxDiffBytes: 1_000_000,
			maxModelTokens: 100_000,
			modelId: "configured-default",
			timeoutDays: 30,
		});
	});

	it("accepts a bounded review.maxModelTokens override", () => {
		const config = repositoryConfigSchema.parse({
			version: 1,
			review: { maxModelTokens: 250_000 },
		});
		expect(config.review.maxModelTokens).toBe(250_000);
	});

	it("accepts bounded checks and review configuration", () => {
		const config = repositoryConfigSchema.parse({
			version: 1,
			checks: [
				{ name: "types", command: "bunx tsc --noEmit", timeoutSeconds: 300 },
			],
			install: { command: "bun install --frozen-lockfile --ignore-scripts" },
			review: {
				debounceSeconds: 10,
				maxChangedFiles: 50,
				maxDiffBytes: 500_000,
			},
		});

		expect(config.review.debounceSeconds).toBe(10);
		expect(config.checks[0]?.timeoutSeconds).toBe(300);
	});

	it.each([
		{
			review: {
				debounceSeconds: REPOSITORY_CONFIG_LIMITS.maxDebounceSeconds + 1,
			},
		},
		{ review: { timeoutDays: REPOSITORY_CONFIG_LIMITS.maxTimeoutDays + 1 } },
		{
			review: { maxChangedFiles: REPOSITORY_CONFIG_LIMITS.maxChangedFiles + 1 },
		},
		{ review: { maxDiffBytes: REPOSITORY_CONFIG_LIMITS.maxDiffBytes + 1 } },
		{ review: { maxModelTokens: REPOSITORY_CONFIG_LIMITS.maxModelTokens + 1 } },
		{
			checks: [
				{
					name: "slow",
					command: "bun test",
					timeoutSeconds: REPOSITORY_CONFIG_LIMITS.maxCheckTimeoutSeconds + 1,
				},
			],
		},
	])("rejects service limit escalation %#", (config) => {
		expect(() =>
			repositoryConfigSchema.parse({ version: 1, ...config }),
		).toThrow();
	});
});
