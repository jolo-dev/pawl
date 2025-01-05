import { CfnOutput, type CfnOutputProps, Tags } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { BasicTags } from "./basic-tags";
import { Stack } from "./stack";

/**
 * An abstract class to define our constructs in HEMS.
 * It contains default behaviour such as tagging (see [BasicTags](./basic-tags.ts)), CFN outputting and monitoring
 */
export abstract class BasicConstruct extends Construct {
  readonly stack: Stack;
  /**
   * The constructor function initializes a custom Stack class instance with basic tags based on
   * predefined keys.
   * @param {Stack} scope - The `scope` parameter in the constructor is typically used to define the
   * parent construct to which the current construct belongs. It helps in organizing constructs within
   * a stack and establishing the hierarchy of resources in your infrastructure. In this case, it seems
   * like the `scope` parameter is of type `Stack`, which
   * @param {string} id - The `id` parameter in the constructor represents the unique identifier for
   * the instance of the class being created. It is typically used to differentiate between multiple
   * instances of the same class within the scope of the application.
   */
  constructor(scope: Stack, id: string) {
    super(scope, id);
    this.stack = Stack.of(this) as Stack; // Because otherwise it thinks it is from type CdkStack but we created our own "Stack"- class
    // Assuming BasicTagsProps is defined somewhere with specific keys
    for (const prop of Object.keys(BasicTags.shape) as Array<keyof typeof BasicTags>) {
      const tag = this.getContext(prop);
      Tags.of(this).add(prop, tag);
    }
  }

  /**
   * The getContext function retrieves a context property, throwing an error if it is not found, and
   * logging an error message if an exception occurs.
   * @param {string} property - The `property` parameter in the `getContext` function is a string that
   * represents the key for retrieving a specific context value using the `tryGetContext` method.
   * @returns If an error occurs during the execution of the `getContext` function, the function will
   * catch the error, log an improved error message to the console, and then return `null`.
   */
  private getContext(property: string) {
    try {
      const context = this.node.tryGetContext(property);
      if (context) {
        return context;
      }
      throw new Error(
        `You need to set the ${property} either in the cdk.context.json or via CLI --context ${property}=foo`,
      );
    } catch (error) {
      console.error("Error retrieving context:", error); // Improved error message
      return null; // Return null or handle the error as needed
    }
  }

  /**
   * The function `setOutput` creates a CloudFormation output with a specified description, value, and
   * export name.
   * @param output - The `output` parameter in the `setOutput` method is an object that must have the
   * properties `description` and `value`, which are required fields from the `CfnOutputProps` type.
   */
  protected setOutput(output: Required<Pick<CfnOutputProps, "description" | "value">>) {
    new CfnOutput(this, output.description, {
      value: output.value,
      description: output.description,
      exportName: `${output.value}-export`,
    });
  }

  /* The `abstract createAlarm(scope: Stack): void;` method in the `BasicConstruct` class is declaring
  an abstract method without providing an implementation within the `BasicConstruct` class itself. */
  abstract createAlarm(scope: Stack): void;
}
