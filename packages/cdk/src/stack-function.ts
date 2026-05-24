import { App } from "aws-cdk-lib/core";
import { Stack } from "./stack";

export type StackFunction = () => void;

export interface StacksProps {
	context?: Record<string, string>;
}

const scopeStack: Stack[] = [];

function currentScope(): Stack {
	const scope = scopeStack.at(-1);
	if (!scope) throw new Error("No active Pawl stack scope");
	return scope;
}

export function resolveScope(scope?: Stack): Stack {
	return scope ?? currentScope();
}

function withScope<T>(scope: Stack, component: () => T): T {
	scopeStack.push(scope);
	try {
		return component();
	} finally {
		scopeStack.pop();
	}
}

function isSynthMode(): boolean {
	return process.env.PAWL_CDK_SYNTH === "1";
}

function createApp(props: StacksProps = {}): App {
	return new App({
		context: {
			...getPawlCdkContext(),
			...props.context,
		},
	});
}

export function stacks(...stackFunctions: StackFunction[]): boolean;
export function stacks(...args: [...StackFunction[], StacksProps]): boolean;
export function stacks(...args: Array<StackFunction | StacksProps>): boolean {
	if (!isSynthMode()) return false;

	const props = getStacksProps(args);
	const stackFunctions = props ? args.slice(0, -1) : args;
	if (stackFunctions.length === 0) {
		throw new Error("At least one stack function is required");
	}

	const app = createApp(props ?? {});
	for (const stackFunction of stackFunctions) {
		if (typeof stackFunction !== "function") {
			throw new Error("Stack functions must be functions");
		}
		if (!stackFunction.name) throw new Error("Stack functions must be named");

		const stack = new Stack(app, stackFunction.name);
		withScope(stack, stackFunction);
	}
	app.synth();
	return true;
}

function getStacksProps(
	args: Array<StackFunction | StacksProps>,
): StacksProps | undefined {
	const maybeProps = args.at(-1);
	return typeof maybeProps === "function" ? undefined : maybeProps;
}

function getPawlCdkContext(): Record<string, string> {
	const rawContext = process.env.PAWL_CDK_CONTEXT;
	if (!rawContext) return {};

	const parsed: unknown = JSON.parse(rawContext);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("PAWL_CDK_CONTEXT must be a JSON object");
	}

	return Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => {
			if (typeof value !== "string") {
				throw new Error(`PAWL_CDK_CONTEXT.${key} must be a string`);
			}
			return [key, value];
		}),
	);
}
