/**
 * DynamoDB scanner.
 *
 * `DynamoDbTable` pins `tableName` to `{prefix}{id}-table`, so a table's name
 * identifies the construct. `ListTables` returns names only, so the arn — and
 * therefore the tags — needs one `DescribeTable` per table.
 */

import {
	DescribeTableCommand,
	DynamoDBClient,
	ListTablesCommand,
	ListTagsOfResourceCommand,
} from "@aws-sdk/client-dynamodb";
import type { DeployedResource } from "../drift";
import { mapWithConcurrency } from "./concurrency";
import type { ResourceScanner, ScannerFactory } from "./types";

const TAG_CONCURRENCY = 10;
const RESOURCE_KIND = "AWS::DynamoDB::Table";

async function readTags(
	client: DynamoDBClient,
	arn: string | undefined,
): Promise<Record<string, string | undefined>> {
	if (!arn) return {};
	try {
		const response = await client.send(
			new ListTagsOfResourceCommand({ ResourceArn: arn }),
		);
		return Object.fromEntries(
			(response.Tags ?? []).flatMap((tag) =>
				tag.Key === undefined ? [] : [[tag.Key, tag.Value]],
			),
		);
	} catch {
		return {};
	}
}

export function createDynamoDbScanner(client: DynamoDBClient): ResourceScanner {
	return {
		service: "dynamodb",
		async scan(): Promise<DeployedResource[]> {
			const names: string[] = [];
			let start: string | undefined;
			do {
				const page = await client.send(
					new ListTablesCommand(
						start === undefined ? {} : { ExclusiveStartTableName: start },
					),
				);
				names.push(...(page.TableNames ?? []));
				start = page.LastEvaluatedTableName;
			} while (start);

			return mapWithConcurrency(names, TAG_CONCURRENCY, async (name) => {
				let arn: string | undefined;
				try {
					const described = await client.send(
						new DescribeTableCommand({ TableName: name }),
					);
					arn = described.Table?.TableArn;
				} catch {
					// A denied describe costs us the arn and the tags, not the table.
				}
				return {
					service: "dynamodb",
					resourceKind: RESOURCE_KIND,
					physicalName: name,
					arn,
					tags: await readTags(client, arn),
				};
			});
		},
	};
}

export const scanDynamoDb: ScannerFactory = (context) =>
	createDynamoDbScanner(
		new DynamoDBClient({
			region: context.region,
			credentials: context.credentials,
		}),
	);
