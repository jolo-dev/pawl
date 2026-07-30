import { Duration } from "aws-cdk-lib";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Alias } from "aws-cdk-lib/aws-lambda";
import { NagSuppressions } from "cdk-nag";
import { z } from "zod";
import { LambdaFunction, type LambdaProps } from "./lambda-function";
import type { Stack } from "./stack";
import { resolveScope } from "./stack-function";

export const DurableLambdaConfigSchema = z.object({
	executionTimeoutSeconds: z.number().int().min(1).max(31_622_400),
	retentionDays: z.number().int().min(1).max(90).default(14),
	aliasName: z
		.string()
		.min(1)
		.max(128)
		.regex(/^(?![0-9]+$)[A-Za-z0-9_-]+$/)
		.default("live"),
});

export type DurableLambdaConfig = z.infer<typeof DurableLambdaConfigSchema>;

export type DurableLambdaFunctionProps = Omit<LambdaProps, "durableConfig"> &
	z.input<typeof DurableLambdaConfigSchema>;

/**
 * A Pawl Lambda function configured for AWS Lambda durable executions.
 */
export class DurableLambdaFunction extends LambdaFunction {
	readonly alias: Alias;
	readonly durableFunctionArn: string;

	constructor(scope: Stack, id: string, props: DurableLambdaFunctionProps);
	constructor(id: string, props: DurableLambdaFunctionProps);
	constructor(
		scopeOrId: Stack | string,
		idOrProps: string | DurableLambdaFunctionProps,
		maybeProps?: DurableLambdaFunctionProps,
	) {
		const scope = typeof scopeOrId === "string" ? resolveScope() : scopeOrId;
		const id = typeof scopeOrId === "string" ? scopeOrId : idOrProps;
		if (typeof id !== "string") {
			throw new Error("Invalid DurableLambdaFunction constructor arguments");
		}
		const props =
			typeof scopeOrId === "string"
				? (idOrProps as DurableLambdaFunctionProps)
				: maybeProps;
		if (!props) {
			throw new Error("Invalid DurableLambdaFunction constructor arguments");
		}

		const {
			executionTimeoutSeconds,
			retentionDays,
			aliasName,
			...lambdaProps
		} = props;
		const durableConfig = DurableLambdaConfigSchema.parse({
			executionTimeoutSeconds,
			retentionDays,
			aliasName,
		});

		super(scope, id, {
			...lambdaProps,
			durableConfig: {
				executionTimeout: Duration.seconds(
					durableConfig.executionTimeoutSeconds,
				),
				retentionPeriod: Duration.days(durableConfig.retentionDays),
			},
		});

		this.alias = new Alias(this, "Alias", {
			aliasName: durableConfig.aliasName,
			version: this.lambda.currentVersion,
		});
		this.durableFunctionArn = this.alias.functionArn;
	}

	/** Grant permission to invoke the durable alias and start executions. */
	grantInvokeDurable(grantee: LambdaFunction): this {
		this.addToGranteeRole(
			grantee,
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ["lambda:InvokeFunction"],
				resources: [this.alias.functionArn],
			}),
		);
		return this;
	}

	/** Grant permission to list and inspect this function's durable executions. */
	grantReadDurableExecutions(grantee: LambdaFunction): this {
		this.addToGranteeRole(
			grantee,
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ["lambda:ListDurableExecutionsByFunction"],
				resources: [this.lambda.functionArn],
			}),
		);
		this.addToGranteeRole(
			grantee,
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					"lambda:GetDurableExecution",
					"lambda:GetDurableExecutionHistory",
				],
				resources: [this.historicalDurableExecutionResourceArn()],
			}),
		);
		this.suppressHistoricalExecutionResourceWildcard(grantee);
		return this;
	}

	/** Grant permission to complete or heartbeat a durable callback. */
	grantSendDurableExecutionCallbacks(grantee: LambdaFunction): this {
		const granteeRole = grantee.lambda.role;
		if (!granteeRole) {
			throw new Error(
				"Cannot grant durable execution callback permissions: the grantee Lambda has no execution role",
			);
		}

		const callbackPolicy = new Policy(
			this,
			`CallbackPolicy${grantee.node.addr}`,
			{
				statements: [
					new PolicyStatement({
						effect: Effect.ALLOW,
						actions: [
							"lambda:SendDurableExecutionCallbackSuccess",
							"lambda:SendDurableExecutionCallbackFailure",
							"lambda:SendDurableExecutionCallbackHeartbeat",
						],
						resources: ["*"],
					}),
				],
			},
		);
		callbackPolicy.attachToRole(granteeRole);
		NagSuppressions.addResourceSuppressions(callbackPolicy, [
			{
				id: "AwsSolutions-IAM5",
				reason:
					"Lambda callback APIs accept only an opaque CallbackId and do not support resource-level IAM permissions.",
				appliesTo: ["Resource::*"],
			},
		]);
		return this;
	}

	/** Grant permission to stop this function's durable executions. */
	grantStopDurableExecution(grantee: LambdaFunction): this {
		this.addToGranteeRole(
			grantee,
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ["lambda:StopDurableExecution"],
				resources: [this.durableExecutionResourceArn()],
			}),
		);
		this.suppressExecutionResourceWildcard(grantee);
		return this;
	}

	private addToGranteeRole(
		grantee: LambdaFunction,
		statement: PolicyStatement,
	): void {
		grantee.lambda.addToRolePolicy(statement);
	}

	private suppressHistoricalExecutionResourceWildcard(
		grantee: LambdaFunction,
	): void {
		const granteePolicy =
			grantee.lambda.role?.node.tryFindChild("DefaultPolicy");
		if (granteePolicy) {
			NagSuppressions.addResourceSuppressions(granteePolicy, [
				{
					id: "AwsSolutions-IAM5",
					reason:
						"Published versions and durable execution names and IDs are not known at synthesis; the three wildcards remain bounded to those segments of this exact named function ARN.",
					appliesTo: [
						{
							regex:
								"/^Resource::<.+LambdaFunction[^>]*\\.Arn>:\\*\\/durable-execution\\/\\*\\/\\*$/",
						},
					],
				},
			]);
		}
	}

	private suppressExecutionResourceWildcard(grantee: LambdaFunction): void {
		const granteePolicy =
			grantee.lambda.role?.node.tryFindChild("DefaultPolicy");
		if (granteePolicy) {
			NagSuppressions.addResourceSuppressions(granteePolicy, [
				{
					id: "AwsSolutions-IAM5",
					reason:
						"Durable execution names and IDs are not known at synthesis; both wildcards remain bounded to those segments of this exact published function version ARN.",
					appliesTo: [
						{
							regex:
								"/^Resource::<.+CurrentVersion[0-9A-Fa-f]+>\\/durable-execution\\/\\*\\/\\*$/",
						},
					],
				},
			]);
		}
	}

	private durableExecutionResourceArn(): string {
		return `${this.alias.version.functionArn}/durable-execution/*/*`;
	}

	private historicalDurableExecutionResourceArn(): string {
		return `${this.lambda.functionArn}:*/durable-execution/*/*`;
	}
}
