import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	GetBucketTaggingCommand,
	ListBucketsCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { createS3Scanner } from "../src/infra/scan/s3";

function mockSend(client: { readonly prototype: unknown }) {
	return spyOn(
		client.prototype as { send(command: unknown): Promise<unknown> },
		"send",
	);
}

describe("s3 scanner", () => {
	let client: S3Client;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => send?.mockRestore());

	it("reports a bucket with an arn and its pawl tags", async () => {
		client = new S3Client({ region: "eu-central-1" });
		send = mockSend(S3Client);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof ListBucketsCommand) {
				return {
					Buckets: [{ Name: "pawlstack-sitebucket-abc123" }],
					$metadata: {},
				};
			}
			if (command instanceof GetBucketTaggingCommand) {
				return {
					TagSet: [{ Key: "team", Value: "platform" }],
					$metadata: {},
				};
			}
			throw new Error("unexpected command");
		});

		const resources = await createS3Scanner(client).scan();

		expect(resources).toEqual([
			{
				service: "s3",
				resourceKind: "AWS::S3::Bucket",
				physicalName: "pawlstack-sitebucket-abc123",
				arn: "arn:aws:s3:::pawlstack-sitebucket-abc123",
				tags: { team: "platform" },
			},
		]);
	});

	it("keeps a bucket that has no tag set at all", async () => {
		client = new S3Client({ region: "eu-central-1" });
		send = mockSend(S3Client);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof ListBucketsCommand) {
				return { Buckets: [{ Name: "untagged-bucket" }], $metadata: {} };
			}
			const error = new Error("The bucket has no tag set");
			error.name = "NoSuchTagSet";
			throw error;
		});

		const resources = await createS3Scanner(client).scan();

		// An untagged bucket is a normal bucket, not a failure.
		expect(resources).toEqual([
			{
				service: "s3",
				resourceKind: "AWS::S3::Bucket",
				physicalName: "untagged-bucket",
				arn: "arn:aws:s3:::untagged-bucket",
				tags: {},
			},
		]);
	});

	it("skips an entry with no name", async () => {
		client = new S3Client({ region: "eu-central-1" });
		send = mockSend(S3Client);
		send.mockImplementation(async () => ({ Buckets: [{}], $metadata: {} }));

		expect(await createS3Scanner(client).scan()).toEqual([]);
	});
});
