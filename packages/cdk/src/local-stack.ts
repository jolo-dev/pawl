import * as fs from "node:fs";
import { App, CfnOutput } from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { LambdaFunction } from "./lambda-function";
import { Stack } from "./stack";

interface LocalStackProps {
  lambdaDir: string;
  runtime: "node20" | "node22";
}

export class LocalStack extends Stack {
  /**
   * The constructor function checks for the existence of a directory specified in the props, creates
   * LambdaFunction instances for each TypeScript file in the directory, and outputs the function URLs.
   * @param {Construct} scope - The `scope` parameter in the constructor function represents the scope
   * in which the construct is created. It is typically the parent construct under which the current
   * construct is being created. This parameter is used to define the hierarchy and relationships
   * between constructs in an AWS CloudFormation template.
   * @param {string} id - The `id` parameter in the constructor function represents the unique
   * identifier for the construct being created. It is used to identify and reference the construct
   * within the scope of the AWS CloudFormation template or CDK application.
   * @param {LocalStackProps} props - The `props` parameter in the constructor function seems to be of
   * type `LocalStackProps`. It likely contains configuration options or properties related to a local
   * stack setup. The code snippet checks for the existence of a directory specified by
   * `props.lambdaDir`, reads the contents of the directory, and creates Lambda
   */
  constructor(scope: Construct, id: string, props: LocalStackProps) {
    super(scope, id);

    const dir = props.lambdaDir;
    if (!fs.existsSync(dir)) {
      throw new Error(`Please check your "lambdaDir": ${dir}`);
    }

    for (const lambda of fs.readdirSync(dir)) {
      const lambdaName = lambda.replace(".ts", "");
      const foo = new LambdaFunction(this, lambdaName, {
        entry: `${dir}/${lambda}`,
      });

      const url = foo.lambda.addFunctionUrl();

      new CfnOutput(this, `${lambdaName}-functionsUrl`, {
        value: url.url,
        exportName: `${lambdaName}-functionsUrl`,
      });
    }
  }
}

/**
 * The function `Local` creates a new `LocalStack` in an AWS CDK application with specified lambda
 * directory and runtime.
 * @param {LocalStackProps} props - The `props` parameter in the `Local` function likely contains
 * information or configurations needed for setting up a local stack. This could include properties
 * such as `lambdaDir` which specifies the directory where Lambda functions are located, and `runtime`
 * which specifies the runtime environment for the Lambda functions. These properties
 */
export const Local = (props: LocalStackProps) => {
  const app = new App();

  new LocalStack(app, "Local", {
    lambdaDir: props.lambdaDir,
    runtime: props.runtime,
  });

  app.synth();
};
