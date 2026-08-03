import { describe, expect, test } from "bun:test";
import {
	PutJobFailureResultCommand,
	PutJobSuccessResultCommand,
	StartPipelineExecutionCommand,
} from "@aws-sdk/client-codepipeline";
import {
	AwsCodePipelineTransport,
	type CodePipelineCommandSender,
	pipelineClientRequestToken,
} from "../src/reviewer/adapters/codepipeline-transport";

class RecordingSender implements CodePipelineCommandSender {
	readonly commands: unknown[] = [];
	async send(command: unknown): Promise<unknown> {
		this.commands.push(command);
		if (command instanceof StartPipelineExecutionCommand) {
			return { pipelineExecutionId: "execution-1" };
		}
		return {};
	}
}

const startInput = {
	pipelineName: "review-pipeline",
	sourceActionName: "Source",
	sourceRevision: "a".repeat(40),
	request: {
		provider: "codecommit",
		repository: "orders",
		requestId: "42",
	},
	generation: 3,
	destinationRevision: "b".repeat(40),
} as const;

describe("AwsCodePipelineTransport", () => {
	test("starts the exact source revision with deterministic Pawl variables", async () => {
		const sender = new RecordingSender();
		const transport = new AwsCodePipelineTransport(sender);

		await expect(transport.startExecution(startInput)).resolves.toEqual({
			executionId: "execution-1",
		});
		expect(sender.commands).toHaveLength(1);
		const command = sender.commands[0];
		expect(command).toBeInstanceOf(StartPipelineExecutionCommand);
		if (!(command instanceof StartPipelineExecutionCommand)) return;
		expect(command.input).toEqual({
			name: "review-pipeline",
			clientRequestToken: pipelineClientRequestToken(startInput),
			sourceRevisions: [
				{
					actionName: "Source",
					revisionType: "COMMIT_ID",
					revisionValue: "a".repeat(40),
				},
			],
			variables: [
				{ name: "PAWL_PROVIDER", value: "codecommit" },
				{ name: "PAWL_REPOSITORY", value: "orders" },
				{ name: "PAWL_REQUEST_ID", value: "42" },
				{ name: "PAWL_GENERATION", value: "3" },
				{ name: "PAWL_SOURCE_REVISION", value: "a".repeat(40) },
				{ name: "PAWL_DESTINATION_REVISION", value: "b".repeat(40) },
			],
		});
	});

	test("uses stable distinct client request tokens", () => {
		const first = pipelineClientRequestToken(startInput);
		expect(first).toBe(pipelineClientRequestToken(startInput));
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(
			pipelineClientRequestToken({ ...startInput, generation: 4 }),
		).not.toBe(first);
		expect(
			pipelineClientRequestToken({
				...startInput,
				destinationRevision: "d".repeat(40),
			}),
		).not.toBe(first);
	});

	test("maps success and bounded failure callbacks", async () => {
		const sender = new RecordingSender();
		const transport = new AwsCodePipelineTransport(sender);

		await transport.putJobSuccess("job-1");
		await transport.putJobFailure({
			jobId: "job-2",
			category: "ReviewFailed",
			message: "x".repeat(2_000),
		});

		expect(sender.commands[0]).toBeInstanceOf(PutJobSuccessResultCommand);
		expect((sender.commands[0] as PutJobSuccessResultCommand).input).toEqual({
			jobId: "job-1",
		});
		expect(sender.commands[1]).toBeInstanceOf(PutJobFailureResultCommand);
		const failure = (sender.commands[1] as PutJobFailureResultCommand).input;
		expect(failure.jobId).toBe("job-2");
		expect(failure.failureDetails?.type).toBe("JobFailed");
		expect(failure.failureDetails?.externalExecutionId).toBe("ReviewFailed");
		expect(failure.failureDetails?.message.length).toBeLessThanOrEqual(1_000);
	});
});
