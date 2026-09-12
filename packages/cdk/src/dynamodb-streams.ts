import { RemovalPolicy } from "aws-cdk-lib";
import {
	AttributeType,
	StreamViewType,
	type TablePropsV2,
	TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import {
	DynamoEventSource,
	type DynamoEventSourceProps,
} from "aws-cdk-lib/aws-lambda-event-sources";
import type { MonitoringFacade } from "cdk-monitoring-constructs";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { LambdaFunction } from "./lambda-function";
import type { Construct, Stack } from "./stack";

/**
 * @interface
 */
export type EventSource = Omit<DynamoEventSourceProps, "startingPosition"> & {
	startingPosition: "LATEST" | "TRIM_HORIZON" | "AT_TIMESTAMP";
};

/**
 * The DynamoDbTableWithStreamsProp
 * @interface
 */
export type DynamoDbTableWithStreamsProps = Omit<
	TablePropsV2,
	"tableName" | "dynamoStream" | "partitionKey"
> & {
	dynamoStream: "KEYS_ONLY" | "NEW_AND_OLD_IMAGES" | "NEW_IMAGE" | "OLD_IMAGE";
	lambdaFunction: LambdaFunction;
	partitionKey: {
		name: string;
		type: "STRING" | "NUMBER" | "BINARY";
	};
	removalPolicy?: "retain" | "destroy";
	existingTable?: string;
	eventSource: EventSource;
} & BasicConstructProps;

/**
 * Creates a new DynamoDB TableV2 with a required stream view and configures a
 * DynamoDB event-source mapping on the supplied Lambda. The existingTable property
 * is unused; this construct does not import a table. Starting position and event
 * source options configure the binding, including its stream-read permissions;
 * the supplied consumer is not created. The table is retained only when
 * removalPolicy is retain, otherwise it is destroyed.
 *
 * More information [here](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html).
 * The mapping node summarizes the configured binding, not a separate consumer.
 *
 * ```mermaid
 * architecture-beta
 *   group streams(logos:aws-dynamodb)[DynamoDB stream consumer]
 *   service table(logos:aws-dynamodb)[Table with stream] in streams
 *   service mapping(logos:aws-lambda)[DynamoDB event source mapping] in streams
 *   table:R --> L:mapping
 * ```
 */
export class DynamoDbTableWithStreams extends BasicConstruct {
	public table: TableV2;
	/**
	 * The constructor function creates a DynamoDB table with streams and adds a Lambda function as an
	 * event source.
	 * @param {Stack} scope - The `scope` parameter in the constructor refers to the stack where the
	 * DynamoDB table and associated resources will be created.
	 * @param {string} id - The `id` parameter in the constructor represents the unique identifier for
	 * the DynamoDB table being created. It is used to name the table and differentiate it from other
	 * resources in the stack.
	 * @param {DynamoDbTableWithStreamsProps} props - props is an object containing properties for
	 * configuring a DynamoDB table with streams. It includes the following properties:
	 */
	constructor(scope: Stack, id: string, props: DynamoDbTableWithStreamsProps) {
		super(scope, id);
		this.table = new TableV2(this, "DynamoDbTable", {
			...props,
			partitionKey: {
				name: props.partitionKey.name,
				type: AttributeType[props.partitionKey.type],
			},
			tableName: this.toPascalCase(id),
			dynamoStream: StreamViewType[props.dynamoStream],
			removalPolicy:
				props.removalPolicy === "retain"
					? RemovalPolicy.RETAIN
					: RemovalPolicy.DESTROY,
		});

		props.lambdaFunction.lambda.addEventSource(
			new DynamoEventSource(this.table, {
				...props.eventSource,
				startingPosition: StartingPosition[props.eventSource.startingPosition],
			}),
		);

		this.createAlarm(this.stack);
	}

	/**
	 * The function createAlarm takes a Stack object as input and returns a MonitoringFacade object that
	 * monitors a DynamoDB table specified in the input stack.
	 * @param {Stack} stack - A stack object that contains information about the resources and
	 * configurations of a cloud infrastructure.
	 * @returns A MonitoringFacade object is being returned.
	 */
	createAlarm(stack: Stack): MonitoringFacade {
		return stack.monitoring.monitorDynamoTable({
			table: this.table,
		});
	}

	private toPascalCase(input: string): string {
		return input
			.replace(/[-_]+/g, " ") // Replace hyphens and underscores with spaces
			.replace(
				/(\w)(\w*)/g,
				(_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase(),
			)
			.replace(/\s+/g, ""); // Remove all spaces
	}

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: PolicyStatement,
	): void {
		console.log("needs to be implemented");
	}
}

export { AttributeType, TableV2 as Table };
