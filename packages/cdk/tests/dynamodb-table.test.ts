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

function createTableWithTeam(team: string): DynamoDbTable {
	const app = createTestApp();
	app.node.setContext("team", team);
	const stack = new Stack(app, "TableNameValidationStack");
	return new DynamoDbTable(stack, "State", {
		partitionKey: { name: "id", type: "STRING" },
	});
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

	test("synthesizes global secondary indexes", () => {
		const indexedTable = createTable(
			{
				partitionKey: { name: "tenantId", type: "STRING" },
				sortKey: { name: "recordId", type: "STRING" },
				globalSecondaryIndexes: [
					{
						indexName: "GSI1",
						partitionKey: { name: "email", type: "STRING" },
					},
					{
						indexName: "GSI2",
						partitionKey: { name: "status", type: "STRING" },
						sortKey: { name: "updatedAt", type: "NUMBER" },
					},
				],
			},
			"Indexed",
		);

		Template.fromStack(Stack.of(indexedTable) as Stack).hasResourceProperties(
			"AWS::DynamoDB::GlobalTable",
			{
				AttributeDefinitions: Match.arrayWith([
					{ AttributeName: "tenantId", AttributeType: "S" },
					{ AttributeName: "recordId", AttributeType: "S" },
					{ AttributeName: "email", AttributeType: "S" },
					{ AttributeName: "status", AttributeType: "S" },
					{ AttributeName: "updatedAt", AttributeType: "N" },
				]),
				GlobalSecondaryIndexes: Match.arrayWith([
					Match.objectLike({
						IndexName: "GSI1",
						KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
					}),
					Match.objectLike({
						IndexName: "GSI2",
						KeySchema: [
							{ AttributeName: "status", KeyType: "HASH" },
							{ AttributeName: "updatedAt", KeyType: "RANGE" },
						],
					}),
				]),
			},
		);
	});

	test("rejects duplicate GSI names and invalid GSI key definitions", () => {
		expect(() =>
			createTable({
				partitionKey: { name: "id", type: "STRING" },
				globalSecondaryIndexes: [
					{
						indexName: "GSI1",
						partitionKey: { name: "email", type: "STRING" },
					},
					{
						indexName: "GSI1",
						partitionKey: { name: "status", type: "STRING" },
					},
				],
			}),
		).toThrow("Global secondary index names must be unique");
		expect(() =>
			createTable({
				partitionKey: { name: "id", type: "STRING" },
				globalSecondaryIndexes: [
					{
						indexName: "GSI1",
						partitionKey: { name: "email", type: "STRING" },
						sortKey: { name: "email", type: "STRING" },
					},
				],
			}),
		).toThrow("GSI partition and sort key names must be different");
		expect(() =>
			createTable({
				partitionKey: { name: "id", type: "STRING" },
				globalSecondaryIndexes: [
					{
						indexName: "GSI1",
						partitionKey: { name: "", type: "STRING" },
					},
				],
			}),
		).toThrow();
	});

	test("rejects a final table name containing a slash from the prefix", () => {
		expect(() => createTableWithTeam("foo/bar")).toThrow(
			"DynamoDB table name must be 3-255 characters and contain only letters, numbers, underscores, periods, and hyphens",
		);
	});

	test("rejects an overlength final table name including the prefix", () => {
		expect(() => createTableWithTeam("x".repeat(242))).toThrow(
			"DynamoDB table name must be 3-255 characters and contain only letters, numbers, underscores, periods, and hyphens",
		);
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
		const policies = Object.values(template.findResources("AWS::IAM::Policy"));
		const policiesFor = (lambda: LambdaFunction) => {
			const roleId = stack.getLogicalId(
				lambda.lambda.role?.node.defaultChild as CfnResource,
			);
			return policies.filter((policy) => {
				const roles = policy.Properties.Roles as unknown;
				return (
					Array.isArray(roles) &&
					roles.length === 1 &&
					typeof roles[0] === "object" &&
					roles[0] !== null &&
					"Ref" in roles[0] &&
					roles[0].Ref === roleId
				);
			});
		};
		const expectPolicy = (lambda: LambdaFunction, actionGroups: string[][]) => {
			const roleId = stack.getLogicalId(
				lambda.lambda.role?.node.defaultChild as CfnResource,
			);
			const matchingPolicies = policiesFor(lambda);
			expect(matchingPolicies).toHaveLength(1);
			expect(matchingPolicies[0]?.Properties.Roles).toEqual([{ Ref: roleId }]);
			expect(matchingPolicies[0]?.Properties.PolicyDocument.Statement).toEqual(
				actionGroups.map((actions) => ({
					Action: actions,
					Effect: "Allow",
					Resource: { "Fn::GetAtt": [tableResourceId, "Arn"] },
				})),
			);
		};

		expectPolicy(stack.readGrantee, [
			[
				"dynamodb:BatchGetItem",
				"dynamodb:Query",
				"dynamodb:GetItem",
				"dynamodb:Scan",
				"dynamodb:ConditionCheckItem",
				"dynamodb:DescribeTable",
			],
			["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
		]);
		expectPolicy(stack.writeGrantee, [
			[
				"dynamodb:BatchWriteItem",
				"dynamodb:PutItem",
				"dynamodb:UpdateItem",
				"dynamodb:DeleteItem",
				"dynamodb:DescribeTable",
			],
		]);
		expectPolicy(stack.readWriteGrantee, [
			[
				"dynamodb:BatchGetItem",
				"dynamodb:Query",
				"dynamodb:GetItem",
				"dynamodb:Scan",
				"dynamodb:ConditionCheckItem",
				"dynamodb:BatchWriteItem",
				"dynamodb:PutItem",
				"dynamodb:UpdateItem",
				"dynamodb:DeleteItem",
				"dynamodb:DescribeTable",
			],
			["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
		]);
		expect(policiesFor(stack.unrelated)).toEqual([]);
	});

	test("constructor permissions support allow, deny, and an explicit resource", () => {
		const permissionStack = new Stack(
			createTestApp(),
			"DynamoDbTablePermissionsStack",
		);
		const allowed = new LambdaFunction(permissionStack, "Allowed", { entry });
		const denied = new LambdaFunction(permissionStack, "Denied", { entry });
		const explicitResource =
			"arn:aws:dynamodb:us-east-1:123456789012:table/Explicit";
		const permissionTable = new DynamoDbTable(permissionStack, "State", {
			partitionKey: { name: "id", type: "STRING" },
			permissions: [
				[allowed, { effect: "allow", actions: ["dynamodb:GetItem"] }],
				[
					denied,
					{
						effect: "deny",
						actions: ["dynamodb:DeleteItem"],
						resource: explicitResource,
					},
				],
			],
		});
		const permissionTemplate = Template.fromStack(permissionStack);
		const tableResourceId = permissionStack.getLogicalId(
			permissionTable.table.node.defaultChild as CfnResource,
		);
		const policies = Object.values(
			permissionTemplate.findResources("AWS::IAM::Policy"),
		);
		const statementFor = (lambda: LambdaFunction) => {
			const roleId = permissionStack.getLogicalId(
				lambda.lambda.role?.node.defaultChild as CfnResource,
			);
			const policy = policies.find((candidate) => {
				const roles = candidate.Properties.Roles as unknown;
				return (
					Array.isArray(roles) &&
					roles.length === 1 &&
					typeof roles[0] === "object" &&
					roles[0] !== null &&
					"Ref" in roles[0] &&
					roles[0].Ref === roleId
				);
			});
			expect(policy?.Properties.Roles).toEqual([{ Ref: roleId }]);
			return policy?.Properties.PolicyDocument.Statement;
		};

		expect(statementFor(allowed)).toEqual([
			{
				Action: "dynamodb:GetItem",
				Effect: "Allow",
				Resource: { "Fn::GetAtt": [tableResourceId, "Arn"] },
			},
		]);
		expect(statementFor(denied)).toEqual([
			{
				Action: "dynamodb:DeleteItem",
				Effect: "Deny",
				Resource: explicitResource,
			},
		]);
	});

	test("constructor permissions reject unsupported grantees after table creation", () => {
		const unsupportedStack = new Stack(
			createTestApp(),
			"DynamoDbTableUnsupportedPermissionsStack",
		);
		expect(
			() =>
				new DynamoDbTable(unsupportedStack, "State", {
					partitionKey: { name: "id", type: "STRING" },
					permissions: [
						[
							unsupportedStack,
							{ effect: "allow", actions: ["dynamodb:GetItem"] },
						],
					],
				}),
		).toThrow(
			"DynamoDbTable permissions support only Pawl LambdaFunction grantees",
		);
		expect(
			unsupportedStack.node
				.findAll()
				.some((construct) =>
					construct.node.path.endsWith("State/DynamoDbTable/Resource"),
				),
		).toBe(true);
	});

	test("deduplicates repeated convenience grants", () => {
		const repeatStack = new Stack(
			createTestApp(),
			"DynamoDbTableRepeatGrantStack",
		);
		const repeatGrantee = new LambdaFunction(repeatStack, "Reader", { entry });
		const repeatTable = new DynamoDbTable(repeatStack, "State", {
			partitionKey: { name: "id", type: "STRING" },
		});
		repeatTable.grantRead(repeatGrantee).grantRead(repeatGrantee);
		const repeatTemplate = Template.fromStack(repeatStack);
		const roleId = repeatStack.getLogicalId(
			repeatGrantee.lambda.role?.node.defaultChild as CfnResource,
		);
		const matchingPolicies = Object.values(
			repeatTemplate.findResources("AWS::IAM::Policy"),
		).filter((policy) => {
			const roles = policy.Properties.Roles as unknown;
			return (
				Array.isArray(roles) &&
				roles.length === 1 &&
				typeof roles[0] === "object" &&
				roles[0] !== null &&
				"Ref" in roles[0] &&
				roles[0].Ref === roleId
			);
		});
		expect(matchingPolicies).toHaveLength(1);
		expect(matchingPolicies[0]?.Properties.Roles).toEqual([{ Ref: roleId }]);
		const tableResourceId = repeatStack.getLogicalId(
			repeatTable.table.node.defaultChild as CfnResource,
		);
		expect(matchingPolicies[0]?.Properties.PolicyDocument.Statement).toEqual([
			{
				Action: [
					"dynamodb:BatchGetItem",
					"dynamodb:Query",
					"dynamodb:GetItem",
					"dynamodb:Scan",
					"dynamodb:ConditionCheckItem",
					"dynamodb:DescribeTable",
				],
				Effect: "Allow",
				Resource: { "Fn::GetAtt": [tableResourceId, "Arn"] },
			},
			{
				Action: ["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
				Effect: "Allow",
				Resource: { "Fn::GetAtt": [tableResourceId, "Arn"] },
			},
		]);
	});

	test("adds a DynamoDB read-capacity metric with the expected table dimension", () => {
		const tableResourceId = stack.getLogicalId(
			stack.stateTable.table.node.defaultChild as CfnResource,
		);
		const dashboards = Object.values(
			template.findResources("AWS::CloudWatch::Dashboard"),
		);
		const hasExpectedMetric = dashboards.some((dashboard) => {
			const dashboardBody = dashboard.Properties.DashboardBody as unknown;
			if (
				typeof dashboardBody !== "object" ||
				dashboardBody === null ||
				!("Fn::Join" in dashboardBody) ||
				!Array.isArray(dashboardBody["Fn::Join"])
			) {
				return false;
			}
			const parts = dashboardBody["Fn::Join"][1];
			if (!Array.isArray(parts)) {
				return false;
			}
			const metricPrefixIndex = parts.findIndex(
				(part) =>
					typeof part === "string" &&
					part.includes(
						'["AWS/DynamoDB","ConsumedReadCapacityUnits","TableName","',
					),
			);
			return (
				metricPrefixIndex >= 0 &&
				JSON.stringify(parts[metricPrefixIndex + 1]) ===
					JSON.stringify({ Ref: tableResourceId })
			);
		});
		expect(hasExpectedMetric).toBe(true);
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
