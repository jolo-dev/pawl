import { App, type Stack, type StackProps } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

/**
 * This function defines and synthesizes the given stacks.
 * @param stacks - Array of stacks to define.
 */
export function defineStacks(
	...stacks: (new (
		scope: Construct,
		id: string,
		props?: StackProps,
	) => Stack)[]
) {
	const app = new App();
	for (const stack of stacks) {
		new stack(app, stack.name);
	}

	app.synth();
}
