/**
 * Lambda scanner.
 *
 * `LambdaFunction` pins `functionName` to `{prefix}{id}-lambda`, so a function's
 * name alone identifies the construct that produced it. Tags are read as well,
 * but a tag failure never drops the resource: the name is the identity, tags
 * only strengthen the provenance claim.
 */

import {
	type FunctionConfiguration,
	LambdaClient,
	ListFunctionsCommand,
	ListTagsCommand,
} from "@aws-sdk/client-lambda";
import type { DeployedResource } from "../drift";
import { mapWithConcurrency } from "./concurrency";
import type { ResourceScanner, ScanContext, ScannerFactory } from "./types";

/** How many tag lookups run at once. High enough to be quick, low enough not to throttle. */
const TAG_CONCURRENCY = 10;

const RESOURCE_KIND = "AWS::Lambda::Function";

async function readTags(
	client: LambdaClient,
	arn: string | undefined,
): Promise<Record<string, string | undefined>> {
	if (!arn) return {};
	try {
		const response = await client.send(new ListTagsCommand({ Resource: arn }));
		return response.Tags ?? {};
	} catch {
		// A denied or failed tag read is not a reason to lose the resource.
		return {};
	}
}

export function createLambdaScanner(client: LambdaClient): ResourceScanner {
	return {
		service: "lambda",
		async scan(): Promise<DeployedResource[]> {
			const functions: FunctionConfiguration[] = [];
			let marker: string | undefined;
			do {
				const page = await client.send(
					new ListFunctionsCommand(
						marker === undefined ? {} : { Marker: marker },
					),
				);
				functions.push(...(page.Functions ?? []));
				marker = page.NextMarker;
			} while (marker);

			const named = functions.filter(
				(fn): fn is FunctionConfiguration & { FunctionName: string } =>
					typeof fn.FunctionName === "string" && fn.FunctionName.length > 0,
			);

			return mapWithConcurrency(named, TAG_CONCURRENCY, async (fn) => ({
				service: "lambda",
				resourceKind: RESOURCE_KIND,
				physicalName: fn.FunctionName,
				arn: fn.FunctionArn,
				tags: await readTags(client, fn.FunctionArn),
			}));
		},
	};
}

export const scanLambda: ScannerFactory = (context: ScanContext) =>
	createLambdaScanner(
		new LambdaClient({
			region: context.region,
			credentials: context.credentials,
		}),
	);
