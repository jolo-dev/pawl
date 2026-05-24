import { App } from "aws-cdk-lib/core";

const teamTag = "foo";
const stageTag = "bar";

export function createTestApp() {
	const app = new App();
	app.node.setContext("team", teamTag);
	app.node.setContext("stage", stageTag);
	return app;
}

// For backward compatibility
const app = createTestApp();
export default app;

export function throwError(message: string): never {
	throw new Error(message);
}
