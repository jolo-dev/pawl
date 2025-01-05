import { Local, defineStacks } from "@hems-lib/cdk";
import { ApiWithAuthorizerStack } from "./stacks/api-with-authorizer-stack";
import { EventBridgeStack } from "./stacks/eventbridge-stack";

/* Uncomment the below to run only your lambdas by using a Helper Function */
// Local({
//   lambdaDir: "./src",
//   runtime: "node22",
// });

/* Uncomment the below to use your own Stack */
defineStacks(EventBridgeStack, ApiWithAuthorizerStack);
