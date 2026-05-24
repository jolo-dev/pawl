import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pawlCdk from "../index";
import { ApiGateway, LambdaFunction, stacks } from "../index";

describe("stack function", () => {
	it("does not expose internal stack scope helpers", () => {
		expect("createStack" in pawlCdk).toBe(false);
		expect("currentScope" in pawlCdk).toBe(false);
		expect("withScope" in pawlCdk).toBe(false);
		expect("isSynthMode" in pawlCdk).toBe(false);
	});

	it("synthesizes a stack function when synth mode is requested", () => {
		const previousSynth = process.env.PAWL_CDK_SYNTH;
		const previousContext = process.env.PAWL_CDK_CONTEXT;
		const previousOutdir = process.env.CDK_OUTDIR;
		let componentRan = false;
		function FunctionStack() {
			componentRan = true;
		}

		try {
			process.env.PAWL_CDK_SYNTH = "1";
			process.env.PAWL_CDK_CONTEXT = JSON.stringify({
				stage: "dev",
				team: "foo",
			});
			process.env.CDK_OUTDIR = path.join(
				tmpdir(),
				`pawl-cdk-test-${randomUUID()}`,
			);

			expect(stacks(FunctionStack)).toBe(true);
			expect(componentRan).toBe(true);
		} finally {
			process.env.PAWL_CDK_SYNTH = previousSynth;
			process.env.PAWL_CDK_CONTEXT = previousContext;
			process.env.CDK_OUTDIR = previousOutdir;
		}
	});

	it("synthesizes multiple stack functions", () => {
		const previousSynth = process.env.PAWL_CDK_SYNTH;
		const previousContext = process.env.PAWL_CDK_CONTEXT;
		const previousOutdir = process.env.CDK_OUTDIR;
		const executed: string[] = [];
		function FirstStack() {
			executed.push("first");
		}
		function SecondStack() {
			executed.push("second");
		}

		try {
			process.env.PAWL_CDK_SYNTH = "1";
			process.env.PAWL_CDK_CONTEXT = JSON.stringify({
				stage: "dev",
				team: "foo",
			});
			process.env.CDK_OUTDIR = path.join(
				tmpdir(),
				`pawl-cdk-test-${randomUUID()}`,
			);

			expect(stacks(FirstStack, SecondStack)).toBe(true);
			expect(executed).toEqual(["first", "second"]);
		} finally {
			process.env.PAWL_CDK_SYNTH = previousSynth;
			process.env.PAWL_CDK_CONTEXT = previousContext;
			process.env.CDK_OUTDIR = previousOutdir;
		}
	});

	it("returns false without creating stacks outside synth mode", () => {
		const previousSynth = process.env.PAWL_CDK_SYNTH;
		let componentRan = false;
		function FunctionStack() {
			componentRan = true;
		}

		try {
			delete process.env.PAWL_CDK_SYNTH;

			expect(stacks(FunctionStack)).toBe(false);
			expect(componentRan).toBe(false);
		} finally {
			process.env.PAWL_CDK_SYNTH = previousSynth;
		}
	});

	it("throws for anonymous stack functions in synth mode", () => {
		const previousSynth = process.env.PAWL_CDK_SYNTH;
		const previousContext = process.env.PAWL_CDK_CONTEXT;
		const previousOutdir = process.env.CDK_OUTDIR;

		try {
			process.env.PAWL_CDK_SYNTH = "1";
			process.env.PAWL_CDK_CONTEXT = JSON.stringify({
				stage: "dev",
				team: "foo",
			});
			process.env.CDK_OUTDIR = path.join(
				tmpdir(),
				`pawl-cdk-test-${randomUUID()}`,
			);

			expect(() => stacks(() => {})).toThrow("Stack functions must be named");
		} finally {
			process.env.PAWL_CDK_SYNTH = previousSynth;
			process.env.PAWL_CDK_CONTEXT = previousContext;
			process.env.CDK_OUTDIR = previousOutdir;
		}
	});

	it("supports function-style constructs inside a stack function", async () => {
		const previousSynth = process.env.PAWL_CDK_SYNTH;
		const previousContext = process.env.PAWL_CDK_CONTEXT;
		const previousOutdir = process.env.CDK_OUTDIR;
		const outdir = path.join(tmpdir(), `pawl-cdk-test-${randomUUID()}`);
		function FunctionStack() {
			const lambda = new LambdaFunction("TestLambdaFunction", {
				entry: path.join(__dirname, "lambda", "test-lambda.ts"),
			});

			new ApiGateway("TestApiGateway", {
				routes: {
					"GET /test": lambda,
				},
			});
		}

		try {
			process.env.PAWL_CDK_SYNTH = "1";
			process.env.PAWL_CDK_CONTEXT = JSON.stringify({
				stage: "dev",
				team: "foo",
			});
			process.env.CDK_OUTDIR = outdir;

			expect(stacks(FunctionStack)).toBe(true);
			const template = await Bun.file(
				path.join(outdir, "FunctionStack.template.json"),
			).json();
			const resources = Object.values(template.Resources) as Array<{
				Type: string;
				Properties: Record<string, unknown>;
			}>;

			expect(resources).toContainEqual(
				expect.objectContaining({
					Type: "AWS::Lambda::Function",
					Properties: expect.objectContaining({
						FunctionName: "foo-dev-TestLambdaFunction-lambda",
					}),
				}),
			);
			expect(resources).toContainEqual(
				expect.objectContaining({
					Type: "AWS::ApiGatewayV2::Api",
					Properties: expect.objectContaining({
						Name: "foo-dev-TestApiGateway-apigateway",
					}),
				}),
			);
			expect(resources).toContainEqual(
				expect.objectContaining({
					Type: "AWS::ApiGatewayV2::Route",
					Properties: expect.objectContaining({
						RouteKey: "GET /test",
					}),
				}),
			);
		} finally {
			process.env.PAWL_CDK_SYNTH = previousSynth;
			process.env.PAWL_CDK_CONTEXT = previousContext;
			process.env.CDK_OUTDIR = previousOutdir;
		}
	});
});
