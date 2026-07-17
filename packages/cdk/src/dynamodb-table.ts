import { RemovalPolicy } from "aws-cdk-lib";
import {
	AttributeType,
	Billing,
	TableEncryptionV2,
	TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
} from "aws-cdk-lib/aws-iam";
import type { MonitoringFacade } from "cdk-monitoring-constructs";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

/** A Pawl-owned DynamoDB key definition. */
export const KeySchema = z.object({
	name: z.string().min(1),
	type: z.enum(["STRING", "NUMBER", "BINARY"]),
});

export type Key = z.infer<typeof KeySchema>;

const DynamoDbTableNameSchema = z
	.string()
	.refine(
		(name) =>
			name.length >= 3 && name.length <= 255 && /^[A-Za-z0-9_.-]+$/.test(name),
		{
			message:
				"DynamoDB table name must be 3-255 characters and contain only letters, numbers, underscores, periods, and hyphens",
		},
	);

/** Durable state-table settings accepted by Pawl. */
export const DynamoDbTablePropsSchema = z
	.object({
		partitionKey: KeySchema,
		sortKey: KeySchema.optional(),
		timeToLiveAttribute: z.string().min(1).optional(),
		pointInTimeRecovery: z.boolean().default(true),
		retain: z.boolean().default(true),
	})
	.refine(
		({ partitionKey, sortKey }) =>
			sortKey === undefined || partitionKey.name !== sortKey.name,
		{
			message: "Partition and sort key names must be different",
			path: ["sortKey", "name"],
		},
	);

export type DynamoDbTableConfig = z.infer<typeof DynamoDbTablePropsSchema>;
export type DynamoDbTableProps = z.input<typeof DynamoDbTablePropsSchema> &
	BasicConstructProps;

/** An on-demand DynamoDB table for durable application state. */
export class DynamoDbTable extends BasicConstruct {
	readonly table: TableV2;
	readonly tableArn: string;
	readonly tableName: string;

	constructor(scope: Stack, id: string, props: DynamoDbTableProps) {
		const { permissions, ...durableProps } = props;
		const config = DynamoDbTablePropsSchema.parse(durableProps);
		super(scope, id);
		const tableName = DynamoDbTableNameSchema.parse(
			`${this.prefix}${id}-table`,
		);

		this.table = new TableV2(this, "DynamoDbTable", {
			partitionKey: {
				name: config.partitionKey.name,
				type: AttributeType[config.partitionKey.type],
			},
			sortKey: config.sortKey
				? {
						name: config.sortKey.name,
						type: AttributeType[config.sortKey.type],
					}
				: undefined,
			tableName,
			timeToLiveAttribute: config.timeToLiveAttribute,
			billing: Billing.onDemand(),
			encryption: TableEncryptionV2.dynamoOwnedKey(),
			pointInTimeRecoverySpecification: {
				pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
			},
			deletionProtection: config.retain,
			removalPolicy: config.retain
				? RemovalPolicy.RETAIN
				: RemovalPolicy.DESTROY,
		});
		this.tableArn = this.table.tableArn;
		this.tableName = this.table.tableName;

		this.createAlarm(this.stack);
		if (permissions) {
			this.grantPermissions(permissions);
		}
	}

	createAlarm(stack: Stack): MonitoringFacade {
		return stack.monitoring.monitorDynamoTable({ table: this.table });
	}

	/** Grant data-plane read access to a Pawl Lambda function. */
	grantRead(grantee: LambdaFunction): this {
		this.table.grantReadData(grantee.lambda);
		return this;
	}

	/** Grant data-plane write access to a Pawl Lambda function. */
	grantWrite(grantee: LambdaFunction): this {
		this.table.grantWriteData(grantee.lambda);
		return this;
	}

	/** Grant data-plane read and write access to a Pawl Lambda function. */
	grantReadWrite(grantee: LambdaFunction): this {
		this.table.grantReadWriteData(grantee.lambda);
		return this;
	}

	protected applyPermissionPolicy(
		construct: Construct,
		policyStatement: PolicyStatement,
	): void {
		if (!(construct instanceof LambdaFunction)) {
			throw new Error(
				"DynamoDbTable permissions support only Pawl LambdaFunction grantees",
			);
		}

		construct.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: policyStatement.effect === "allow" ? Effect.ALLOW : Effect.DENY,
				actions: policyStatement.actions,
				resources: [policyStatement.resource ?? this.tableArn],
			}),
		);
	}
}
