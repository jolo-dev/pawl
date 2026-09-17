import { describe, expect, test } from "bun:test";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	type Tool,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import { z } from "zod";
import { costInputSchema } from "../agent/tools/cost";
import { deployInfraInputSchema } from "../agent/tools/deploy_infra";
import { deployPreviewInputSchema } from "../agent/tools/deploy_preview";
import { initProjectInputSchema } from "../agent/tools/init_project";
import { scanResourcesInputSchema } from "../agent/tools/scan_resources";
import { wellArchitectedInputSchema } from "../agent/tools/well_architected";
import {
	definePawlTool,
	toolParameters,
	UnsupportedToolSchemaError,
} from "../src/pi-runtime/tool-schema";

const schema = z.object({
	name: z.string().min(1).describe("Required project name"),
	profile: z.string().optional(),
	install: z.boolean().optional(),
	stacks: z.array(z.string()).optional(),
	limit: z.number().int().min(1).max(10).default(2),
	stage: z.enum(["dev", "prod"]).default("dev"),
	tags: z.record(z.string(), z.string()).optional(),
	config: z.object({ region: z.string() }),
});
const minimal = { name: "proof", config: { region: "eu-west-1" } };
const nonCanonicalDefault = { name: "proof", extra: true };

async function runTool(
	tool: AgentTool<Tool["parameters"], unknown>,
	raw: Record<string, unknown>,
) {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall(tool.name, raw), {
			stopReason: "toolUse",
		}),
	]);
	const preflight: unknown[] = [];
	const agent = new Agent({
		initialState: { model: faux.getModel(), tools: [tool] },
		streamFn: models.streamSimple.bind(models),
		beforeToolCall: async ({ args }) => {
			preflight.push(args);
			return undefined;
		},
		shouldStopAfterTurn: () => true,
	});
	await agent.prompt("Exercise the schema bridge offline.");
	expect(faux.state.callCount).toBe(1);
	const results = agent.state.messages.filter(
		(message) => message.role === "toolResult",
	);
	expect(results).toHaveLength(1);
	return { result: results[0], preflight };
}

function recordingTool<
	S extends z.ZodObject<z.core.$ZodShape, z.core.$ZodObjectConfig>,
>(inputSchema: S) {
	const executed: z.output<S>[] = [];
	const tool = definePawlTool({
		name: "proof_tool",
		label: "Proof tool",
		description: "Offline schema proof",
		schema: inputSchema,
		execute: async (_id, parsed) => {
			executed.push(parsed);
			return { content: [{ type: "text", text: "ok" }], details: parsed };
		},
	});
	return { tool, executed };
}

describe("Pi/Zod tool schema bridge", () => {
	test("plain generated JSON schema satisfies the public Pi parameter type and validator", () => {
		const parameters: Tool["parameters"] = toolParameters(schema);
		expect(parameters).toEqual(z.toJSONSchema(schema, { io: "input" }));
		const parsed = schema.parse(minimal);
		expect(
			validateToolArguments(
				{ name: "proof", description: "proof", parameters },
				{
					type: "toolCall",
					id: "1",
					name: "proof",
					arguments: parsed,
				},
			),
		).toEqual(parsed);
	});

	test.each([
		minimal,
		{
			...minimal,
			profile: "local",
			install: false,
			stacks: ["app"],
			limit: 10,
			stage: "prod",
			tags: { team: "platform" },
		},
		{ ...minimal, profile: "", stacks: [], tags: {}, limit: 1 },
		{
			...minimal,
			unexpected: "stripped",
			config: { ...minimal.config, extra: true },
		},
	])("executes only canonical parsed values: %j", async (raw) => {
		const original = structuredClone(raw);
		const { tool, executed } = recordingTool(schema);
		const { result, preflight } = await runTool(tool, raw);
		expect(result?.isError).toBe(false);
		expect(executed).toEqual([schema.parse(raw)]);
		// Approval code must hash these canonical values, never raw toolCall.arguments.
		expect(preflight).toEqual(executed);
		expect(raw).toEqual(original);
	});

	const invalidInputs: Record<string, unknown>[] = [
		{ ...minimal, limit: "2" },
		{ ...minimal, install: "false" },
		{ ...minimal, profile: null },
		{ ...minimal, install: null },
		{ ...minimal, stacks: null },
		{ ...minimal, stage: "test" },
		{ ...minimal, limit: 0 },
		{ ...minimal, limit: 11 },
		{ ...minimal, limit: 2.5 },
		{ ...minimal, name: "" },
		{ config: minimal.config },
		{ name: "proof", config: {} },
		{ ...minimal, stacks: [2] },
		{ ...minimal, tags: { count: 2 } },
	];
	test.each(
		invalidInputs,
	)("rejects invalid raw values before Pi coercion, preflight and execution: %j", async (raw) => {
		const { tool, executed } = recordingTool(schema);
		const { result, preflight } = await runTool(tool, raw);
		expect(result?.isError).toBe(true);
		expect(executed).toEqual([]);
		expect(preflight).toEqual([]);
	});

	test("rejects min(2) at registration because Zod accepts a single non-BMP emoji", () => {
		const incompatible = z.object({ value: z.string().min(2) });
		expect(incompatible.parse({ value: "😀" })).toEqual({ value: "😀" });
		expect(() => toolParameters(incompatible)).toThrow(
			UnsupportedToolSchemaError,
		);
		expect(() => recordingTool(incompatible)).toThrow(
			/Unicode.*UTF-16.*grapheme.*min\(0\).*min\(1\)/,
		);
	});

	test.each([
		{ name: "min(-1)", value: z.string().min(-1) },
		{ name: "min(0.5)", value: z.string().min(0.5) },
		{ name: "min(3)", value: z.string().min(3) },
		{ name: "max(0)", value: z.string().max(0) },
		{ name: "max(1)", value: z.string().max(1) },
		{ name: "max(2)", value: z.string().max(2) },
		{ name: "length(0)", value: z.string().length(0) },
		{ name: "length(1)", value: z.string().length(1) },
		{ name: "length(2)", value: z.string().length(2) },
	])("rejects unsupported string constraint $name before advertising it", ({
		value,
	}) => {
		const incompatible = z.object({ value });
		expect(() => toolParameters(incompatible)).toThrow(
			UnsupportedToolSchemaError,
		);
		expect(() => recordingTool(incompatible)).toThrow(
			/Unicode.*UTF-16.*grapheme.*min\(0\).*min\(1\)/,
		);
	});

	const unicodeInputs = ["😀", "e\u0301", "👩‍💻", "東京", "é", ""];
	test.each(
		unicodeInputs,
	)("min(1) preserves Unicode input without normalization: %j", async (value) => {
		const nonempty = z.object({ value: z.string().min(1) });
		const raw = { value };
		const valid = value !== "";
		expect(nonempty.safeParse(raw).success).toBe(valid);
		const { tool, executed } = recordingTool(nonempty);
		expect(tool.parameters).toMatchObject({
			properties: { value: { type: "string", minLength: 1 } },
		});
		const { result, preflight } = await runTool(tool, raw);
		expect(result?.isError).toBe(!valid);
		expect(executed).toEqual(valid ? [raw] : []);
		expect(preflight).toEqual(executed);
	});

	test.each([
		{ name: "unbounded", value: z.string() },
		{ name: "min(0)", value: z.string().min(0) },
	])("$name strings accept Unicode and empty input unchanged", async ({
		value,
	}) => {
		const inputSchema = z.object({ value });
		const { tool, executed } = recordingTool(inputSchema);
		expect(tool.parameters).toEqual(
			z.toJSONSchema(inputSchema, { io: "input" }),
		);
		for (const value of unicodeInputs) {
			const raw = { value };
			expect(inputSchema.parse(raw)).toEqual(raw);
			const { result, preflight } = await runTool(tool, raw);
			expect(result?.isError).toBe(false);
			expect(preflight).toEqual([raw]);
		}
		expect(executed).toEqual(unicodeInputs.map((value) => ({ value })));
	});

	test("a permissive custom native predicate cannot bypass Pi's advertised constraint", async () => {
		// Public Zod cannot distinguish this override from its native length predicate.
		// Such overrides are outside the trusted registry's authoring contract.
		const custom = z.object({
			value: z.string().check(
				new z.core.$ZodCheckMinLength({
					check: "min_length",
					minimum: 1,
					when: () => false,
				}),
			),
		});
		expect(custom.parse({ value: "" })).toEqual({ value: "" });
		const { tool, executed } = recordingTool(custom);
		const { result, preflight } = await runTool(tool, { value: "" });
		expect(result?.isError).toBe(true);
		expect(preflight).toEqual([]);
		expect(executed).toEqual([]);
	});

	test("scalar and canonical collection defaults survive both validation passes unchanged", async () => {
		const defaults = z.object({
			profile: z.string().default("local"),
			install: z.boolean().default(false),
			stacks: z.array(z.string()).default([]),
			tags: z.record(z.string(), z.string()).default({ team: "platform" }),
			config: z.object({ region: z.string() }).default({ region: "eu-west-1" }),
		});
		const { tool, executed } = recordingTool(defaults);
		const { result, preflight } = await runTool(tool, {});
		expect(result?.isError).toBe(false);
		expect(executed).toEqual([defaults.parse({})]);
		expect(preflight).toEqual(executed);
	});

	test("strict objects reject unexpected keys before execution", async () => {
		const { tool, executed } = recordingTool(schema.strict());
		expect(tool.parameters).toMatchObject({ additionalProperties: false });
		const { result, preflight } = await runTool(tool, {
			...minimal,
			extra: true,
		});
		expect(result?.isError).toBe(true);
		expect(preflight).toEqual([]);
		expect(executed).toEqual([]);
	});

	test("executor boundary parses again even when Pi preflight is bypassed", async () => {
		const { tool, executed } = recordingTool(schema);
		await expect(
			tool.execute("direct", { ...minimal, limit: "2" }),
		).rejects.toThrow();
		expect(executed).toEqual([]);
		await tool.execute("direct", { ...minimal, extra: true });
		expect(executed).toEqual([schema.parse(minimal)]);
	});

	test("forwards execution context and updates without changing parsed input", async () => {
		const signal = new AbortController().signal;
		const updates: unknown[] = [];
		const tool = definePawlTool({
			name: "forward",
			label: "Forward",
			description: "Proof",
			schema,
			executionMode: "sequential",
			replay: "never",
			execute: async (id, parsed, receivedSignal, onUpdate) => {
				expect(id).toBe("call");
				expect(receivedSignal).toBe(signal);
				expect(parsed).toEqual(schema.parse(minimal));
				const result = {
					content: [],
					details: { done: true },
					terminate: true,
				};
				onUpdate?.(result);
				return result;
			},
		});
		expect(tool.executionMode).toBe("sequential");
		expect(tool.replay).toBe("never");
		const result = await tool.execute("call", minimal, signal, (update) =>
			updates.push(update),
		);
		expect(updates).toEqual([result]);
	});

	const authoredSchemas: {
		name: string;
		schema: z.ZodObject<z.core.$ZodShape, z.core.$ZodObjectConfig>;
		valid: Record<string, unknown>;
		invalid: Record<string, unknown>;
	}[] = [
		{
			name: "cost",
			schema: costInputSchema,
			valid: { scanAccount: false },
			invalid: { scanAccount: "false" },
		},
		{
			name: "well_architected",
			schema: wellArchitectedInputSchema,
			valid: {},
			invalid: { scanAccount: null },
		},
		{
			name: "deploy_preview",
			schema: deployPreviewInputSchema,
			valid: { stack: "app" },
			invalid: { stack: 2 },
		},
		{
			name: "deploy_infra",
			schema: deployInfraInputSchema,
			valid: {},
			invalid: { stack: null },
		},
		{
			name: "scan_resources",
			schema: scanResourcesInputSchema,
			valid: { services: ["lambda"], skipSynth: true, maxEntries: 1000 },
			invalid: { maxEntries: "2" },
		},
		{
			name: "init_project",
			schema: initProjectInputSchema,
			valid: {
				projectName: "proof",
				packageManager: "bun",
				awsProfile: "local",
				testMode: "none",
				team: "platform",
				stage: "dev",
				tags: { team: "platform" },
				install: false,
			},
			invalid: {},
		},
	];
	test.each(
		authoredSchemas,
	)("runs the actual exported $name schema without invoking its Eve executor", async ({
		schema: authored,
		valid,
		invalid,
	}) => {
		const { tool, executed } = recordingTool(authored);
		expect((await runTool(tool, valid)).result?.isError).toBe(false);
		expect(executed).toEqual([authored.parse(valid)]);
		expect((await runTool(tool, invalid)).result?.isError).toBe(true);
		expect(executed).toHaveLength(1);
	});

	test.each([
		z.object({ value: z.string().refine((value) => value === "ok") }),
		z.object({ value: z.string() }).refine((value) => value.value === "ok"),
		z.object({ value: z.string().transform((value) => value.length) }),
		z.object({ value: z.string().trim() }),
		z.object({
			value: z
				.string()
				.superRefine((_value, context) =>
					context.addIssue({ code: "custom", message: "no" }),
				),
		}),
		z.object({ value: z.string().overwrite((value) => value.toLowerCase()) }),
		z.object({ value: z.string() }).passthrough(),
		z.object({ value: z.coerce.number() }),
		z.object({ value: z.date() }),
		z.object({ value: z.bigint() }),
		z.object({ value: z.union([z.string(), z.number()]) }),
		z.object({ value: z.string().catch("fallback") }),
		z.object({ value: z.string().email() }),
		z.object({ value: z.array(z.string().refine(() => true)) }),
		z.object({
			value: z.record(
				z.string(),
				z.string().transform((value) => value),
			),
		}),
		z.object({ value: z.string().min(1).default("") }),
		z.object({
			value: z.object({ name: z.string() }).default(nonCanonicalDefault),
		}),
		z.object({ value: z.string().meta({ pattern: "not-generated" }) }),
	])("rejects unsupported or unrepresentable schemas before advertising a tool: %j", (unsupported) => {
		expect(() => toolParameters(unsupported)).toThrow(
			"Unsupported Pawl tool schema",
		);
		expect(() => recordingTool(unsupported)).toThrow(
			"Unsupported Pawl tool schema",
		);
	});
});
