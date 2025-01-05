import { Duration } from "aws-cdk-lib";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  type NodejsFunctionProps,
  OutputFormat,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { BasicConstruct } from "./basic-construct";
import type { Stack } from "./stack";

export interface LambdaProps
  extends Omit<NodejsFunctionProps, "code" | "runtime" | "handler" | "architecture"> {
  entry: string;
  authorizer?: boolean;
}

/**
 * ```mermaid
 * architecture-beta
 *   service lambda(logos:aws-lambda)[AWS Lambda]
 *   service authorizer(logos:aws-cognito)[Authorizer]
 * ```
 */
export class LambdaFunction extends BasicConstruct {
  public lambda: NodejsFunction;
  public authorizer?: boolean;
  /**
   * The above function is a TypeScript constructor that creates a Lambda function with specific
   * configurations, including using Node.js 22.x runtime and bundling to ESM format for efficiency.
   * @param {Stack} scope - The `scope` parameter in the constructor refers to the AWS CloudFormation
   * stack where the Lambda function will be deployed. It provides a way to define the logical
   * boundaries for the resources within the stack.
   * @param {string} id - The `id` parameter in the constructor function represents the unique
   * identifier or name for the Lambda function being created. It is typically used to distinguish this
   * specific Lambda function from others within the same scope or stack.
   * @param {LambdaProps} props - LambdaProps is a type that contains properties for configuring a
   * Lambda function. In this case, it includes an `authorizer` property that is being assigned to
   * `this.authorizer`. The `NodejsFunction` constructor is being used to create a new Lambda function
   * with specific configurations such as function name,
   */
  constructor(scope: Stack, id: string, props: LambdaProps) {
    super(scope, id);
    this.authorizer = props.authorizer;
    this.lambda = new NodejsFunction(this, "LambdaFunction", {
      ...props,
      functionName: `${id}-lambda`,
      architecture: Architecture.ARM_64, // for efficiency
      runtime: Runtime.NODEJS_22_X, // The NODEJS_LATEST would point to Node 18
      // Bundle to ESM
      bundling: {
        minify: true,
        format: OutputFormat.ESM,
        target: "node22",
        // Tracer is in CJS: https://docs.powertools.aws.dev/lambda/typescript/latest/core/tracer/#usage
        esbuildArgs: {
          "--tree-shaking": "true",
        },
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
    });

    this.createAlarm(this.stack);
  }

  createAlarm(stack: Stack): void {
    console.log(stack);

    stack.monitoring.monitorLambdaFunction({
      lambdaFunction: this.lambda,
      addLatencyP99Alarm: {
        Critical: {
          maxLatency: Duration.seconds(1),
        },
      },
    });
  }
}
