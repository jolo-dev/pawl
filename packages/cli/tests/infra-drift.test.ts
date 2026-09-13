import { describe, expect, test } from "bun:test";
import {
	classifyDrift,
	type DeployedResource,
	type SynthesizedResource,
} from "../src/infra/drift";

const synth = (
	over: Partial<SynthesizedResource> = {},
): SynthesizedResource => ({
	stackName: "PawlStack",
	logicalId: "MyApiLambdaFunction1A2B3C",
	resourceKind: "AWS::Lambda::Function",
	...over,
});

const deployed = (over: Partial<DeployedResource> = {}): DeployedResource => ({
	service: "lambda",
	resourceKind: "AWS::Lambda::Function",
	physicalName: "platform-dev-myapi-lambda",
	tags: {},
	...over,
});

describe("classifyDrift", () => {
	test("returns nothing for empty input", () => {
		expect(classifyDrift({ synthesized: [], deployed: [] })).toEqual([]);
	});

	test("matches on CloudFormation stack and logical id", () => {
		const entries = classifyDrift({
			synthesized: [synth({ physicalName: "platform-dev-myapi-lambda" })],
			deployed: [
				deployed({
					stackName: "PawlStack",
					logicalId: "MyApiLambdaFunction1A2B3C",
				}),
			],
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]?.status).toBe("matched");
		expect(entries[0]?.basis).toBe("logical-id");
	});

	test("prefers the logical id over a physical name match", () => {
		const byName = synth({
			logicalId: "ByNameOnly",
			physicalName: "platform-dev-myapi-lambda",
		});
		const byLogicalId = synth({ logicalId: "MyApiLambdaFunction1A2B3C" });

		const entries = classifyDrift({
			synthesized: [byName, byLogicalId],
			deployed: [
				deployed({
					stackName: "PawlStack",
					logicalId: "MyApiLambdaFunction1A2B3C",
				}),
			],
		});

		const matched = entries.find((e) => e.status === "matched");
		expect(matched?.basis).toBe("logical-id");
		expect(matched?.synthesized?.logicalId).toBe("MyApiLambdaFunction1A2B3C");
		// The physical-name candidate is left alone rather than double-matched.
		expect(
			entries.find((e) => e.synthesized?.logicalId === "ByNameOnly")?.status,
		).toBe("not-deployed");
	});

	test("falls back to the pinned physical name", () => {
		const entries = classifyDrift({
			synthesized: [synth({ physicalName: "platform-dev-myapi-lambda" })],
			deployed: [deployed()],
		});

		expect(entries[0]?.status).toBe("matched");
		expect(entries[0]?.basis).toBe("physical-name");
	});

	test("reports a synthesized resource that was never deployed", () => {
		const entries = classifyDrift({
			synthesized: [synth({ physicalName: "platform-dev-myapi-lambda" })],
			deployed: [],
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]?.status).toBe("not-deployed");
		expect(entries[0]?.synthesized?.logicalId).toBe(
			"MyApiLambdaFunction1A2B3C",
		);
	});

	test("reports a resource with no synthesized counterpart as unmanaged", () => {
		const entries = classifyDrift({
			synthesized: [],
			deployed: [deployed({ physicalName: "some-console-created-queue" })],
		});

		expect(entries[0]?.status).toBe("unmanaged");
		expect(entries[0]?.basis).toBe("none");
	});

	test("reports a pawl-looking resource with no counterpart as foreign", () => {
		const entries = classifyDrift({
			synthesized: [],
			deployed: [deployed({ physicalName: "platform-dev-otherapi-lambda" })],
		});

		expect(entries[0]?.status).toBe("foreign");
		expect(entries[0]?.basis).toBe("provenance");
		expect(entries[0]?.provenance?.constructId).toBe("otherapi");
	});

	test("treats pawl tags alone as foreign provenance", () => {
		const entries = classifyDrift({
			synthesized: [],
			deployed: [
				deployed({
					physicalName: "a-codebuild-project",
					tags: { team: "platform", stage: "dev" },
				}),
			],
		});

		expect(entries[0]?.status).toBe("foreign");
		expect(entries[0]?.provenance?.team).toBe("platform");
	});

	test("consumes a synthesized resource once", () => {
		const entries = classifyDrift({
			synthesized: [synth({ physicalName: "platform-dev-myapi-lambda" })],
			deployed: [
				deployed(),
				deployed({ physicalName: "platform-dev-myapi-lambda" }),
			],
		});

		expect(entries.filter((e) => e.status === "matched")).toHaveLength(1);
		expect(entries.filter((e) => e.status === "foreign")).toHaveLength(1);
	});

	test("explains why each entry landed where it did", () => {
		const entries = classifyDrift({
			synthesized: [synth({ physicalName: "platform-dev-myapi-lambda" })],
			deployed: [deployed({ physicalName: "totally-unrelated" })],
		});

		for (const entry of entries) {
			expect(entry.reason.length).toBeGreaterThan(0);
		}
	});

	test("does not pair a logical id from a different stack", () => {
		const entries = classifyDrift({
			synthesized: [synth()],
			deployed: [
				deployed({
					stackName: "SomeOtherStack",
					logicalId: "MyApiLambdaFunction1A2B3C",
				}),
			],
		});

		// The resource still carries Pawl provenance from its name, so it is
		// reported as foreign rather than silently ignored.
		expect(entries.map((e) => e.status).sort()).toEqual([
			"foreign",
			"not-deployed",
		]);
	});
});
