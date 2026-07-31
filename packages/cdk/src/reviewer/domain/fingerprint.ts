import { createHash } from "node:crypto";
import type { FindingCategory, FindingFingerprint } from "./finding";

export interface FindingFingerprintInput {
	readonly provider: string;
	readonly repository: string;
	readonly requestId: string;
	readonly category: FindingCategory;
	readonly path: string;
	readonly nearbyCode: readonly string[];
	readonly issueIdentity: string;
	readonly line?: number;
}

function normalizeIssueIdentity(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCode(lines: readonly string[]): readonly string[] {
	return lines.map((line) => line.replace(/\r\n?/g, "\n"));
}

export function createFindingFingerprint(
	input: FindingFingerprintInput,
): FindingFingerprint {
	const identity = JSON.stringify({
		version: 1,
		provider: input.provider,
		repository: input.repository,
		requestId: input.requestId,
		category: input.category,
		path: input.path,
		nearbyCode: normalizeCode(input.nearbyCode),
		issueIdentity: normalizeIssueIdentity(input.issueIdentity),
	});
	const digest = createHash("sha256").update(identity, "utf8").digest("hex");
	return `review-finding:v1:${digest}`;
}
