import type { RepositoryCheckConfig } from "../domain/repository-config";
import type { RequestRef, ReviewCycleSnapshot } from "../domain/review-request";

export interface CheckRunInput {
	readonly request: RequestRef;
	readonly snapshot: ReviewCycleSnapshot;
	readonly installCommand?: string;
	readonly checks: readonly RepositoryCheckConfig[];
}

export interface CheckResult {
	readonly name: string;
	readonly status: "passed" | "failed";
	readonly exitCode: number;
	readonly durationMs: number;
	readonly boundedLog: string;
	readonly logTruncated: boolean;
}

export type CheckRunResult =
	| { readonly status: "completed"; readonly checks: readonly CheckResult[] }
	| {
			readonly status: "infrastructure-failure";
			readonly code: string;
			readonly message: string;
			readonly retryable: boolean;
	  }
	| { readonly status: "timed-out"; readonly message: string };

export interface CheckRunner {
	run(input: CheckRunInput): Promise<CheckRunResult>;
}
