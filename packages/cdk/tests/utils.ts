import { App } from "aws-cdk-lib/core";

const teamTag = "foo";
const stageTag = "bar";
const app = new App();
app.node.setContext("team", teamTag);
app.node.setContext("stage", stageTag);

export default app;
