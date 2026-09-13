/**
 * S3 scanner.
 *
 * S3 is the weakest case for name-based provenance: pawl's `StaticSite`
 * construct lets CDK generate its bucket names (`SiteBucket`, `AccessLogsBucket`
 * with no `bucketName`), so a bucket's name does not identify the construct.
 * Only the `team` and `stage` tags establish ownership, which is why S3
 * resources land as `foreign` rather than a named construct when unmatched.
 *
 * `ListBuckets` is not region-scoped: it returns every bucket in the account
 * regardless of the client's region.
 */

import {
	GetBucketTaggingCommand,
	ListBucketsCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { DeployedResource } from "../drift";
import { mapWithConcurrency } from "./concurrency";
import type { ResourceScanner, ScannerFactory } from "./types";

const TAG_CONCURRENCY = 10;
const RESOURCE_KIND = "AWS::S3::Bucket";

export function createS3Scanner(client: S3Client): ResourceScanner {
	return {
		service: "s3",
		async scan(): Promise<DeployedResource[]> {
			const page = await client.send(new ListBucketsCommand({}));
			const names = (page.Buckets ?? [])
				.map((bucket) => bucket.Name)
				.filter(
					(name): name is string => typeof name === "string" && name.length > 0,
				);

			return mapWithConcurrency(names, TAG_CONCURRENCY, async (name) => {
				let tags: Record<string, string | undefined> = {};
				try {
					const tagging = await client.send(
						new GetBucketTaggingCommand({ Bucket: name }),
					);
					tags = Object.fromEntries(
						(tagging.TagSet ?? []).flatMap((tag) =>
							tag.Key === undefined ? [] : [[tag.Key, tag.Value]],
						),
					);
				} catch {
					// A bucket with no tag set is a normal bucket, not a failure.
					tags = {};
				}
				return {
					service: "s3",
					resourceKind: RESOURCE_KIND,
					physicalName: name,
					arn: `arn:aws:s3:::${name}`,
					tags,
				};
			});
		},
	};
}

export const scanS3: ScannerFactory = (context) =>
	createS3Scanner(
		new S3Client({
			region: context.region,
			credentials: context.credentials,
		}),
	);
