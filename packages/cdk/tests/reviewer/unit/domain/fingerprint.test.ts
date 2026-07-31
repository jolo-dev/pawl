import { describe, expect, it } from "bun:test";
import { createFindingFingerprint } from "../../../../src/reviewer/domain/fingerprint";

const input = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
	category: "correctness",
	path: "src/checkout.ts",
	nearbyCode: ["const subtotal = cart.total;", "return subtotal + tax;"],
	issueIdentity: "nullable subtotal used in arithmetic",
} as const;

describe("createFindingFingerprint", () => {
	it("preserves identity when only the line moves", () => {
		expect(createFindingFingerprint({ ...input, line: 20 })).toBe(
			createFindingFingerprint({ ...input, line: 75 }),
		);
	});

	it.each([
		{ category: "reliability" },
		{ path: "src/refund.ts" },
		{ issueIdentity: "retry loop has no bound" },
	])("changes identity when stable issue input changes %#", (change) => {
		expect(createFindingFingerprint(input)).not.toBe(
			createFindingFingerprint({ ...input, ...change }),
		);
	});

	it.each([
		"provider",
		"repository",
		"requestId",
	] as const)("preserves case distinctions in opaque %s identifiers", (field) => {
		expect(
			createFindingFingerprint({ ...input, [field]: "case-sensitive" }),
		).not.toBe(
			createFindingFingerprint({ ...input, [field]: "CASE-SENSITIVE" }),
		);
	});

	it("preserves code-significant whitespace", () => {
		expect(
			createFindingFingerprint({
				...input,
				nearbyCode: ['const value = "a  b";'],
			}),
		).not.toBe(
			createFindingFingerprint({
				...input,
				nearbyCode: ['const value = "a b";'],
			}),
		);
	});

	it("is an opaque digest with no source or comment content", () => {
		const sourceBody = "SECRET_SOURCE_BODY";
		const commentText = "SECRET_HUMAN_COMMENT";
		const untrustedInput = {
			...input,
			nearbyCode: [sourceBody],
			sourceBody,
			commentText,
		};
		const fingerprint = createFindingFingerprint(untrustedInput);

		expect(fingerprint).toMatch(/^review-finding:v1:[a-f0-9]{64}$/);
		expect(fingerprint).not.toContain(sourceBody);
		expect(fingerprint).not.toContain(commentText);
	});
});
