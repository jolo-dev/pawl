import { isDeepStrictEqual } from "node:util";
import type {
	AgentTool,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import { z } from "zod";

type ObjectSchema = z.ZodObject<z.core.$ZodShape, z.core.$ZodObjectConfig>;

export class UnsupportedToolSchemaError extends Error {
	constructor(reason: string) {
		super(`Unsupported Pawl tool schema: ${reason}`);
		this.name = "UnsupportedToolSchemaError";
	}
}

// This is a bounded Stage 1 bridge, not a general Zod-to-Pi converter. In
// particular, toJSONSchema alone silently omits custom refinements/overwrites.
function checkSchema(schema: z.core.$ZodType): void {
	const def = schema._zod.def;
	const metadata = z.globalRegistry.get(schema);
	if (
		metadata &&
		Object.keys(metadata).some(
			(key) => key !== "description" && key !== "title",
		)
	) {
		throw new UnsupportedToolSchemaError(
			"only description/title metadata is supported",
		);
	}
	if ("coerce" in def && def.coerce) {
		throw new UnsupportedToolSchemaError("coercion");
	}
	for (const check of def.checks ?? []) {
		const constraint = check._zod.def;
		const nativeLength =
			schema instanceof z.ZodString &&
			(check instanceof z.core.$ZodCheckMinLength ||
				check instanceof z.core.$ZodCheckMaxLength ||
				check instanceof z.core.$ZodCheckLengthEquals);
		const supported =
			nativeLength ||
			(schema instanceof z.ZodNumber &&
				["greater_than", "less_than"].includes(constraint.check)) ||
			(schema instanceof z.ZodNumber &&
				constraint.check === "number_format" &&
				"format" in constraint &&
				constraint.format === "safeint");
		// Zod installs `when` on native length checks. Public custom overrides
		// cannot be distinguished: they are outside this trusted, fixed registry's
		// authoring contract. Pi still validates the advertised length constraint.
		if (!supported || (constraint.when && !nativeLength)) {
			throw new UnsupportedToolSchemaError(`check ${constraint.check}`);
		}
	}
	if (schema instanceof z.ZodObject) {
		if (schema.def.catchall && !(schema.def.catchall instanceof z.ZodNever)) {
			throw new UnsupportedToolSchemaError("object catchall/passthrough");
		}
		for (const child of Object.values(schema.shape)) checkSchema(child);
	} else if (
		schema instanceof z.ZodOptional ||
		schema instanceof z.ZodDefault
	) {
		checkSchema(schema.def.innerType);
		if (schema instanceof z.ZodDefault) {
			// Zod defaults bypass their inner parser. Reject defaults that would
			// change between preflight and execution (e.g. stripped extra keys).
			const value = schema.def.defaultValue;
			const parsed = z.safeParse(schema.def.innerType, value);
			if (!parsed.success || !isDeepStrictEqual(value, parsed.data)) {
				throw new UnsupportedToolSchemaError("default is not canonical input");
			}
		}
	} else if (schema instanceof z.ZodArray) {
		checkSchema(schema.element);
	} else if (schema instanceof z.ZodRecord) {
		if (
			!(schema.keyType instanceof z.ZodString) ||
			!(schema.valueType instanceof z.ZodString)
		) {
			throw new UnsupportedToolSchemaError("only string records are supported");
		}
		checkSchema(schema.keyType);
		checkSchema(schema.valueType);
	} else if (schema instanceof z.ZodString || schema instanceof z.ZodNumber) {
		if ("format" in def && def.format !== "safeint") {
			throw new UnsupportedToolSchemaError(`format ${def.format}`);
		}
	} else if (
		!(schema instanceof z.ZodBoolean) &&
		!(schema instanceof z.ZodEnum)
	) {
		throw new UnsupportedToolSchemaError(`type ${def.type}`);
	}
}

export function toolParameters(schema: ObjectSchema): Tool["parameters"] {
	checkSchema(schema);
	return z.toJSONSchema(schema, { io: "input" });
}

type PawlToolDefinition<S extends ObjectSchema, Details> = Pick<
	AgentTool<Tool["parameters"], Details>,
	"name" | "label" | "description" | "executionMode" | "replay"
> & {
	schema: S;
	execute: (
		toolCallId: string,
		input: z.output<S>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<Details>,
	) => Promise<AgentToolResult<Details>>;
};

export function definePawlTool<S extends ObjectSchema, Details>(
	definition: PawlToolDefinition<S, Details>,
): AgentTool<Tool["parameters"], Details> {
	const { schema, execute, ...metadata } = definition;
	return {
		...metadata,
		parameters: toolParameters(schema),
		// Pi 0.85.1 otherwise coerces primitives and drops optional nulls before
		// beforeToolCall. Zod must see raw arguments first, without that repair.
		prepareArguments: (raw: unknown) => schema.parse(raw),
		execute: async (id, raw: unknown, signal, onUpdate) => {
			// Policy/approval hashing in the executor must use this canonical input,
			// not the original tool-call arguments (defaults and stripped keys differ).
			const input = schema.parse(raw);
			return execute(id, input, signal, onUpdate);
		},
	};
}
