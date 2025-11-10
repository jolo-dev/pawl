import { Local, defineStacks } from "@pawl/cdk";
import { TheLambdaPowerTunerStack } from "./lib/the-lambda-power-tuner-stack";

/* Uncomment the below to run only your lambdas by using a Helper Function */
// Local({
//   lambdaDir: "./src",
//   runtime: "node22",
// });

/* Uncomment the below to use your own Stack */
defineStacks(TheLambdaPowerTunerStack);
