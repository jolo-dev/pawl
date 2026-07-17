import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Aspects, type CfnResource } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import type { Construct } from "constructs";
import { DynamoDbTable } from "../src/dynamodb-table";
import { LambdaFunction } from "../src/lambda-function";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

const entry = path.join(__dirname, "lambda", "test-lambda.ts");

class DynamoDbTableTestStack extends Stack {
	readonly stateTable: DynamoDbTable;
	readonly readGrantee: LambdaFunction;
	readonly writeGrantee: LambdaFunction;
	readonly readWriteGrantee: LambdaFunction;
	readonly unrelated: LambdaFunction;

	constructor(scope: Construct, id: string) {
		super(scope, id);
		this.stateTable = new DynamoDbTable(this, "State", {
			partitionKey: { name: "tenantId", type: "STRING" },
			sortKey: { name: "recordId", type: "STRING" },
			timeToLiveAttribute: "expiresAt",
		});
		this.readGrantee = new LambdaFunction(this, "Reader", { entry });
		this.writeGrantee = new LambdaFunction(this, "Writer", { entry });
		this.readWriteGrantee = new LambdaFunction(this, "ReaderWriter", {
			entry,
		});
		this.unrelated = new LambdaFunction(this, "Unrelated", { entry });

		this.stateTable
			.grantRead(this.readGrantee)
			.grantWrite(this.writeGrantee)
			.grantReadWrite(this.readWriteGrantee);
	}
}

function createTable(
	props: ConstructorParameters<typeof DynamoDbTable>[2],
	id = "State",
): DynamoDbTable {
	const stack = new Stack(createTestApp(), `${id}ValidationStack`);
	return new DynamoDbTable(stack, id, props);
}

describe("DynamoDbTable", () => {
	const stack = new DynamoDbTableTestStack(
		createTestApp(),
		"DynamoDbTableTestStack",
	);
	const template = Template.fromStack(stack);

	test("synthesizes a retained, encrypted on-demand table with Pawl defaults", () => {
		template.hasResource("AWS::DynamoDB::GlobalTable", {
			DeletionPolicy: "Retain",
			UpdateReplacePolicy: "Retain",
			Properties: {
				AttributeDefinitions: [
					{ AttributeName: "tenantId", AttributeType: "S" },
					{ AttributeName: "recordId", AttributeType: "S" },
				],
				BillingMode: "PAY_PER_REQUEST",
				KeySchema: [
					{ AttributeName: "tenantId", KeyType: "HASH" },
					{ AttributeName: "recordId", KeyType: "RANGE" },
				],
				Replicas: [
					Match.objectLike({
						DeletionProtectionEnabled: true,
						PointInTimeRecoverySpecification: {
							PointInTimeRecoveryEnabled: true,
						},
						Tags: [
							{ Key: "stage", Value: "bar" },
							{ Key: "team", Value: "foo" },
						],
					}),
				],
				SSESpecification: {
					SSEEnabled: false,
				},
				TableName: "foo-bar-State-table",
				TimeToLiveSpecification: {
					AttributeName: "expiresAt",
					Enabled: true,
				},
			},
		});
	});

	test("retain false disables deletion protection and uses destroy behavior", () => {
		const destroyTable = createTable(
			{
				partitionKey: { name: "id", type: "STRING" },
				retain: false,
			},
			"Ephemeral",
		);
		const destroyTemplate = Template.fromStack(Stack.of(destroyTable) as Stack);
		destroyTemplate.hasResource("AWS::DynamoDB::GlobalTable", {
			DeletionPolicy: "Delete",
			UpdateReplacePolicy: "Delete",
			Properties: {
				Replicas: [Match.objectLike({ DeletionProtectionEnabled: false })],
			},
		});
	});

	test("exposes the underlying table attributes", () => {
		expect(stack.stateTable.table).toBeDefined();
		expect(stack.stateTable.tableArn).toBe(stack.stateTable.table.tableArn);
		expect(stack.stateTable.tableName).toBe(stack.stateTable.table.tableName);
	});

	test.each([
		["empty partition key", { partitionKey: { name: "", type: "STRING" } }],
		[
			"empty sort key",
			{
				partitionKey: { name: "id", type: "STRING" },
				sortKey: { name: "", type: "STRING" },
			},
		],
		[
			"empty TTL attribute",
			{
				partitionKey: { name: "id", type: "STRING" },
				timeToLiveAttribute: "",
			},
		],
		[
			"duplicate key names",
			{
				partitionKey: { name: "id", type: "STRING" },
				sortKey: { name: "id", type: "NUMBER" },
			},
		],
	])("rejects %s during construction", (_name, props) => {
		expect(() => createTable(props)).toThrow();
	});

	test.each([
		["STRING", "S"],
		["NUMBER", "N"],
		["BINARY", "B"],
	] as const)("maps the %s key type", (type, attributeType) => {
		const table = createTable({
			partitionKey: { name: "id", type },
		});
		Template.fromStack(Stack.of(table) as Stack).hasResourceProperties(
			"AWS::DynamoDB::GlobalTable",
			{
				AttributeDefinitions: [
					{ AttributeName: "id", AttributeType: attributeType },
				],
			},
		);
	});

	test("grants exact read, write, and read-write action families only to each grantee role", () => {
		const tableResourceId = stack.getLogicalId(
			stack.stateTable.table.node.defaultChild as CfnResource,
		);
		const roleId = (lambda: LambdaFunction) =>
			stack.getLogicalId(lambda.lambda.role?.node.defaultChild as CfnResource);
		const policies = Object.values(template.findResources("AWS::IAM::Policy"));
		const policyFor = (lambda: LambdaFunction) => {
			const id = roleId(lambda);
			return policies.find((policy) =>
				JSON.stringify(policy).includes(`"Ref":"${id}"`),
			);
		};
		const actionSet = (lambda: LambdaFunction) => {
			const policy = policyFor(lambda);
			expect(policy).toBeDefined();
			const statements = policy?.Properties.PolicyDocument.Statement as Array<{
				Action: string | string[];
				Resource: unknown;
			}>;
			for (const statement of statements) {
				expect(statement.Resource).toEqual({
					"Fn::GetAtt": [tableResourceId, "Arn"],
				});
			}
			return new Set(
				statements.flatMap(({ Action }) =>
					Array.isArray(Action) ? Action : [Action],
				),
			);
		};

		expect(actionSet(stack.readGrantee)).toEqual(
			new Set([
				"dynamodb:BatchGetItem",
				"dynamodb:ConditionCheckItem",
				"dynamodb:DescribeTable",
				"dynamodb:GetItem",
				"dynamodb:GetRecords",
				"dynamodb:GetShardIterator",
				"dynamodb:Query",
				"dynamodb:Scan",
			]),
		);
		expect(actionSet(stack.writeGrantee)).toEqual(
			new Set([
				"dynamodb:BatchWriteItem",
				"dynamodb:DeleteItem",
				"dynamodb:DescribeTable",
				"dynamodb:PutItem",
				"dynamodb:UpdateItem",
			]),
		);
		expect(actionSet(stack.readWriteGrantee)).toEqual(
			new Set([
				"dynamodb:BatchGetItem",
				"dynamodb:BatchWriteItem",
				"dynamodb:ConditionCheckItem",
				"dynamodb:DeleteItem",
				"dynamodb:DescribeTable",
				"dynamodb:GetItem",
				"dynamodb:GetRecords",
				"dynamodb:GetShardIterator",
				"dynamodb:PutItem",
				"dynamodb:Query",
				"dynamodb:Scan",
				"dynamodb:UpdateItem",
			]),
		);
		expect(policyFor(stack.unrelated)).toBeUndefined();
	});

	test("adds DynamoDB metrics to the monitoring dashboard", () => {
		const dashboards = template.findResources("AWS::CloudWatch::Dashboard");
		expect(JSON.stringify(dashboards)).toContain("AWS/DynamoDB");
		expect(JSON.stringify(dashboards)).toContain("ConsumedReadCapacityUnits");
		expect(JSON.stringify(dashboards)).toContain("foo-bar-State-table");
	});

	test("passes AwsSolutions checks without table suppressions", () => {
		const nagStack = new Stack(createTestApp(), "DynamoDbTableNagStack");
		new DynamoDbTable(nagStack, "State", {
			partitionKey: { name: "id", type: "STRING" },
		});
		Aspects.of(nagStack).add(new AwsSolutionsChecks());
		nagStack.node.root.synth();

		const errors = Annotations.fromStack(nagStack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-.*"),
		);
		expect(errors).toEqual([]);
	});
});
