import { Duration } from "aws-cdk-lib";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
	ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import {
	NodejsFunction,
	type NodejsFunctionProps,
	OutputFormat,
} from "aws-cdk-lib/aws-lambda-nodejs";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { Construct, Stack } from "./stack";
import { resolveScope } from "./stack-function";

/**
 * @interface
 */
export type LambdaProps = {
	entry: string;
	authorizer?: boolean;
} & Omit<
	NodejsFunctionProps,
	"functionName" | "code" | "runtime" | "handler" | "architecture"
> &
	BasicConstructProps;
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
	constructor(scope: Stack, id: string, props: LambdaProps);
	constructor(id: string, props: LambdaProps);
	constructor(
		scopeOrId: Stack | string,
		idOrProps: string | LambdaProps,
		maybeProps?: LambdaProps,
	) {
		const scope = typeof scopeOrId === "string" ? resolveScope() : scopeOrId;
		const id = typeof scopeOrId === "string" ? scopeOrId : idOrProps;
		if (typeof id !== "string") {
			throw new Error("Invalid LambdaFunction constructor arguments");
		}
		const props =
			typeof scopeOrId === "string" ? (idOrProps as LambdaProps) : maybeProps;
		if (!props) throw new Error("Invalid LambdaFunction constructor arguments");

		super(scope, id);
		this.authorizer = props.authorizer;
		this.lambda = new NodejsFunction(this, "LambdaFunction", {
			...props,
			functionName: `${this.prefix}${id}-lambda`,
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
		stack.monitoring.monitorLambdaFunction({
			lambdaFunction: this.lambda,
			addLatencyP99Alarm: {
				Critical: {
					maxLatency: Duration.seconds(1),
				},
			},
		});
	}

	/**
	 * Implementation of the abstract method to apply permission policies to this resource
	 * @param construct The construct that will be granted permissions to this Lambda
	 * @param policyStatement The permission policy to apply
	 */
	protected applyPermissionPolicy(
		construct: Construct,
		policyStatement: PolicyStatement,
	): void {
		// First, translate our generic PolicyStatement to AWS IAM PolicyStatement
		const iamPolicyStatement = new IamPolicyStatement({
			effect: policyStatement.effect === "allow" ? Effect.ALLOW : Effect.DENY,
			actions: policyStatement.actions,
			resources: [policyStatement.resource || this.lambda.functionArn],
		});

		// Check if the construct is a service principal
		if (construct instanceof ServicePrincipal) {
			// Apply the policy directly
			if (policyStatement.effect === "allow") {
				this.lambda.addPermission(`${construct.service}Permission`, {
					principal: construct,
					action: policyStatement.actions.join(","),
				});
			}
		}
		this.lambda.addToRolePolicy(iamPolicyStatement);
	}

	/**
	 * Grant this Lambda permission to invoke another BasicConstruct
	 * @param construct The construct to invoke
	 * @param actions The actions to grant
	 * @returns The BasicLambda instance for method chaining
	 */
	public grantInvoke(
		construct: BasicConstruct,
		actions: string[],
	): LambdaFunction {
		construct.grantPermission(this, {
			effect: "allow",
			actions: actions,
		});
		return this;
	}
}
