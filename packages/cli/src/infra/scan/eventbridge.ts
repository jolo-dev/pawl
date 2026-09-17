/**
 * EventBridge scanner.
 *
 * Reports event buses. `EventBridge` takes `eventBusName` from props rather than
 * deriving it from the construct id, so a bus name does not identify the
 * construct — only its tags do. The construct's dead-letter queue *is*
 * name-derived (`{prefix}{eventBusName}-dlq`) and is found by the SQS scanner.
 */

import {
	EventBridgeClient,
	ListEventBusesCommand,
	ListTagsForResourceCommand,
} from "@aws-sdk/client-eventbridge";
import type { DeployedResource } from "../drift";
import { mapWithConcurrency } from "./concurrency";
import type { ResourceScanner, ScannerFactory } from "./types";

const TAG_CONCURRENCY = 10;
const RESOURCE_KIND = "AWS::Events::EventBus";

export function createEventBridgeScanner(
	client: Pick<EventBridgeClient, "send">,
): ResourceScanner {
	return {
		service: "eventbridge",
		async scan(): Promise<DeployedResource[]> {
			const buses: { name: string; arn?: string }[] = [];
			let token: string | undefined;
			do {
				const page = await client.send(
					new ListEventBusesCommand(
						token === undefined ? {} : { NextToken: token },
					),
				);
				for (const bus of page.EventBuses ?? []) {
					if (bus.Name) buses.push({ name: bus.Name, arn: bus.Arn });
				}
				token = page.NextToken;
			} while (token);

			return mapWithConcurrency(buses, TAG_CONCURRENCY, async (bus) => {
				let tags: Record<string, string | undefined> = {};
				if (bus.arn) {
					try {
						const response = await client.send(
							new ListTagsForResourceCommand({ ResourceARN: bus.arn }),
						);
						tags = Object.fromEntries(
							(response.Tags ?? []).flatMap((tag) =>
								tag.Key === undefined ? [] : [[tag.Key, tag.Value]],
							),
						);
					} catch {
						tags = {};
					}
				}
				return {
					service: "eventbridge",
					resourceKind: RESOURCE_KIND,
					physicalName: bus.name,
					arn: bus.arn,
					tags,
				};
			});
		},
	};
}

export const scanEventBridge: ScannerFactory = (context) =>
	createEventBridgeScanner(
		new EventBridgeClient({
			region: context.region,
			credentials: context.credentials,
		}),
	);
