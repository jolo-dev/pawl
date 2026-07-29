import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { Logger } from "@aws-lambda-powertools/logger";
import { type CodePipelineJobEvent, useCodePipelineHandler } from "../index";

const infoMock = mock(() => {});
let infoSpy: { mockRestore: () => void };

const rawUserParameters = "NEVER_LOG_USER_PARAMETERS";
const accessKeyId = "NEVER_LOG_ACCESS_KEY";
const artifactName = "NEVER_LOG_ARTIFACT_NAME";
const artifactBucket = "NEVER_LOG_ARTIFACT_BUCKET";

const event: CodePipelineJobEvent = {
	"CodePipeline.job": {
		id: "job-id",
		accountId: "123456789012",
		data: {
			actionTypeId: {
				category: "Invoke",
				owner: "AWS",
				provider: "Lambda",
				version: "1",
			},
			actionConfiguration: {
				configuration: {
					FunctionName: "handler-name",
					UserParameters: rawUserParameters,
				},
			},
			inputArtifacts: [
				{
					name: artifactName,
					location: {
						type: "S3",
						s3Location: {
							bucketName: artifactBucket,
							objectKey: "input.zip",
						},
					},
				},
			],
			outputArtifacts: [
				{
					name: "NEVER_LOG_OUTPUT_ARTIFACT_NAME",
					location: {
						type: "S3",
						s3Location: {
							bucketName: "NEVER_LOG_OUTPUT_ARTIFACT_BUCKET",
							objectKey: "output.zip",
						},
					},
				},
			],
			artifactCredentials: {
				accessKeyId,
				secretAccessKey: "NEVER_LOG_SECRET_ACCESS_KEY",
				sessionToken: "NEVER_LOG_SESSION_TOKEN",
			},
		},
	},
};

describe("codepipeline-handler", () => {
	beforeAll(() => {
		infoSpy = spyOn(Logger.prototype, "info").mockImplementation(infoMock);
	});

	afterAll(() => {
		infoSpy.mockRestore();
	});

	it("invokes the callback, resolves void, and logs only safe job metadata", async () => {
		const handleRequest = mock(
			async (receivedEvent: CodePipelineJobEvent, logger: Logger) => {
				expect(receivedEvent).toBe(event);
				expect(logger).toBeInstanceOf(Logger);
			},
		);
		const handler = useCodePipelineHandler("foo", handleRequest);
		const previousCallCount = infoMock.mock.calls.length;

		expect(await handler(event)).toBeUndefined();
		expect(handleRequest).toHaveBeenCalledTimes(1);
		expect(infoMock.mock.calls).toHaveLength(previousCallCount + 1);
		const inputLogCall = infoMock.mock.calls.at(-1);
		expect(inputLogCall).toEqual([
			"Processing request",
			{
				event: {
					jobId: "job-id",
					actionType: {
						category: "Invoke",
						owner: "AWS",
						provider: "Lambda",
						version: "1",
					},
					inputArtifactCount: 1,
					outputArtifactCount: 1,
				},
			},
		]);

		const loggedMetadata = JSON.stringify(inputLogCall);
		expect(loggedMetadata).not.toContain(accessKeyId);
		expect(loggedMetadata).not.toContain("secretAccessKey");
		expect(loggedMetadata).not.toContain(rawUserParameters);
		expect(loggedMetadata).not.toContain("UserParameters");
		expect(loggedMetadata).not.toContain(artifactName);
		expect(loggedMetadata).not.toContain(artifactBucket);
		expect(loggedMetadata).not.toContain("inputArtifacts");
		expect(loggedMetadata).not.toContain("outputArtifacts");
	});

	it("exposes before, after, and error hooks", async () => {
		const calls: string[] = [];
		const handler = useCodePipelineHandler("foo", async (receivedEvent) => {
			calls.push("handle");
			expect(receivedEvent).toBe(event);
		});

		handler.addBeforeHook((receivedEvent) => {
			calls.push("before");
			expect(receivedEvent).toBe(event);
			return receivedEvent;
		});
		handler.addAfterHook((result) => {
			calls.push("after");
			expect(result).toBeUndefined();
		});
		handler.addErrorHook(() => {
			calls.push("error");
		});

		expect(await handler(event)).toBeUndefined();
		expect(calls).toEqual(["before", "handle", "after"]);
	});
});
