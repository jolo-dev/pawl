/**
 * SQS scanner.
 *
 * `Sqs` pins `queueName` to `{prefix}{id}-sqs` and its dead-letter queue to
 * `{prefix}{id}-dlq`, so both names identify the construct — though `-dlq` is
 * also emitted by `EventBridge` for its own dead-letter queue, which is why the
 * provenance parser reports that suffix as ambiguous rather than guessing.
 */

import {
	GetQueueAttributesCommand,
	ListQueuesCommand,
	ListQueueTagsCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import type { DeployedResource } from "../drift";
import { mapWithConcurrency } from "./concurrency";
import type { ResourceScanner, ScannerFactory } from "./types";

const TAG_CONCURRENCY = 10;
const RESOURCE_KIND = "AWS::SQS::Queue";

/** The queue name is the last path segment of its url. */
function queueNameFromUrl(url: string): string {
	const segment = url
		.split("/")
		.filter((part) => part.length > 0)
		.pop();
	return segment ?? url;
}

export function createSqsScanner(
	client: Pick<SQSClient, "send">,
): ResourceScanner {
	return {
		service: "sqs",
		async scan(): Promise<DeployedResource[]> {
			const urls: string[] = [];
			let token: string | undefined;
			do {
				const page = await client.send(
					new ListQueuesCommand(
						token === undefined ? {} : { NextToken: token },
					),
				);
				urls.push(...(page.QueueUrls ?? []));
				token = page.NextToken;
			} while (token);

			return mapWithConcurrency(urls, TAG_CONCURRENCY, async (url) => {
				let arn: string | undefined;
				try {
					const attributes = await client.send(
						new GetQueueAttributesCommand({
							QueueUrl: url,
							AttributeNames: ["QueueArn"],
						}),
					);
					arn = attributes.Attributes?.QueueArn;
				} catch {
					// Keep the queue; only the arn and tags are lost.
				}

				let tags: Record<string, string | undefined> = {};
				try {
					const tagResponse = await client.send(
						new ListQueueTagsCommand({ QueueUrl: url }),
					);
					tags = tagResponse.Tags ?? {};
				} catch {
					tags = {};
				}

				return {
					service: "sqs",
					resourceKind: RESOURCE_KIND,
					physicalName: queueNameFromUrl(url),
					arn,
					tags,
				};
			});
		},
	};
}

export const scanSqs: ScannerFactory = (context) =>
	createSqsScanner(
		new SQSClient({
			region: context.region,
			credentials: context.credentials,
		}),
	);
