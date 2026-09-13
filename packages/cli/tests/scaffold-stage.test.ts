import { describe, expect, test } from "bun:test";
import { BasicTags } from "@pawl/cdk";
import { scaffoldStageSchema } from "../src/scaffold/types";

/**
 * `src/scaffold/types.ts` keeps its own stage enum instead of deriving it from
 * `@pawl/cdk`, because authored eve modules bundle their whole import graph and
 * the CDK library is far too heavy to pull in for one enum. This test is the
 * guard that the two never drift.
 */
describe("scaffold stage schema", () => {
	test("stays in sync with @pawl/cdk BasicTags", () => {
		expect(scaffoldStageSchema.options).toEqual(BasicTags.shape.stage.options);
	});

	test("accepts every stage BasicTags accepts", () => {
		for (const stage of BasicTags.shape.stage.options) {
			expect(scaffoldStageSchema.safeParse(stage).success).toBe(true);
		}
	});
});
