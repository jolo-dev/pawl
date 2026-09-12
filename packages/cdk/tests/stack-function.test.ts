import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pawlCdk from "../index";
import { ApiGateway, LambdaFunction, stacks } from "../index";

const envKeys = ["PAWL_CDK_SYNTH", "PAWL_CDK_CONTEXT", "CDK_OUTDIR"] as const;

describe("stack function", () => {
	let previousEnv: Record<string, string | undefined>;
	let outdir: string;

	beforeEach(() => {
		previousEnv = Object.fromEntries(
			envKeys.map((key) => [key, process.env[key]]),
		);
		outdir = mkdtempSync(path.join(tmpdir(), "pawl-cdk-test-"));
		process.env.PAWL_CDK_SYNTH = "1";
		process.env.PAWL_CDK_CONTEXT = JSON.stringify({
			stage: "dev",
			team: "foo",
		});
		process.env.CDK_OUTDIR = outdir;
	});

	afterEach(() => {
		for (const key of envKeys) {
			const value = previousEnv[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(outdir, { recursive: true, force: true });
	});

	it("does not expose internal stack scope helpers", () => {
		expect("createStack" in pawlCdk).toBe(false);
		expect("currentScope" in pawlCdk).toBe(false);
		expect("withScope" in pawlCdk).toBe(false);
		expect("isSynthMode" in pawlCdk).toBe(false);
	});

	it("synthesizes a stack function when synth mode is requested", () => {
		let componentRan = false;
		function FunctionStack() {
			componentRan = true;
		}

		expect(stacks(FunctionStack)).toBe(true);
		expect(componentRan).toBe(true);
	});

	it("synthesizes multiple stack functions", () => {
		const executed: string[] = [];
		function FirstStack() {
			executed.push("first");
		}
		function SecondStack() {
			executed.push("second");
		}

		expect(stacks(FirstStack, SecondStack)).toBe(true);
		expect(executed).toEqual(["first", "second"]);
	});

	it("returns false without creating stacks outside synth mode", () => {
		let componentRan = false;
		function FunctionStack() {
			componentRan = true;
		}
		delete process.env.PAWL_CDK_SYNTH;

		expect(stacks(FunctionStack)).toBe(false);
		expect(componentRan).toBe(false);
	});

	it("throws for anonymous stack functions in synth mode", () => {
		expect(() => stacks(() => {})).toThrow("Stack functions must be named");
	});

	it("supports function-style constructs inside a stack function", async () => {
		function FunctionStack() {
			const lambda = new LambdaFunction("TestLambdaFunction", {
				entry: path.join(__dirname, "lambda", "test-lambda.ts"),
			});

			new ApiGateway("TestApiGateway", {
				routes: { "GET /test": lambda },
			});
		}

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
	});
});
