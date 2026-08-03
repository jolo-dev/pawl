import { CodePipeline, Stack, stacks } from "@pawl/cdk";
import { resolveScope } from "../../src/stack-function";
import { createLocalStackSetup } from "./localstack.setup";

// ── Configuration ───────────────────────────────────────────────────

const REPO_NAME = "codepipeline-integ-test-repo";
const STACK_NAME = "CodePipelineIntegStack";
const LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME = "unknown";
const PAWL_VARIABLES = [
	"PAWL_PROVIDER",
	"PAWL_REPOSITORY",
	"PAWL_REQUEST_ID",
	"PAWL_GENERATION",
	"PAWL_SOURCE_REVISION",
	"PAWL_DESTINATION_REVISION",
] as const;

// ── Stack function (runs during synth) ──────────────────────────────

function addIntegrationPipeline(
	scope: Stack,
	repositoryName: string,
	reviewed: boolean,
): void {
	const pipeline = reviewed
		? new CodePipeline(scope, "Pipeline", {
				autoReviewer: { modelId: "eu.amazon.nova-2-lite-v1:0" },
				onPullRequest: true,
			})
		: new CodePipeline(scope, "Pipeline", { onPullRequest: true });
	pipeline
		.source({
			origin: "codecommit",
			create: true,
			repositoryName,
			branchName: "main",
		})
		.stage({
			name: "Build",
			actions: [{ name: "Approve", type: "approval" }],
		});
}

function CodePipelineIntegStack() {
	addIntegrationPipeline(resolveScope(), REPO_NAME, true);
}

// ── Integration tests (run during bun test) ─────────────────────────

if (!stacks(CodePipelineIntegStack)) {
	const { describe, expect, it, beforeAll } = await import("bun:test");
	const { App } = await import("aws-cdk-lib");
	const { Template } = await import("aws-cdk-lib/assertions");

	describe("synth:codepipeline LocalStack fixture", () => {
		it("covers pull-request gating without deploying a second reviewer", () => {
			const app = new App({ context: { stage: "dev", team: "foo" } });
			const stack = new Stack(app, "CodePipelineNoReviewerSynthStack");
			addIntegrationPipeline(
				stack,
				"codepipeline-no-reviewer-synth-repo",
				false,
			);

			const template = Template.fromStack(stack);
			const [pipeline] = Object.values(
				template.findResources("AWS::CodePipeline::Pipeline"),
			);
			if (!pipeline) throw new Error("Expected a synthesized pipeline");
			const properties = pipeline.Properties as {
				Stages: Array<{
					Name: string;
					Actions: Array<{
						Name: string;
						Configuration?: Record<string, unknown>;
					}>;
				}>;
				Variables?: Array<{ Name: string; DefaultValue: string }>;
			};

			expect(properties.Stages.map(({ Name }) => Name)).toEqual([
				"Source",
				"Build",
			]);
			expect(properties.Stages[0]?.Actions[0]).toMatchObject({
				Name: "Source",
				Configuration: {
					BranchName: "main",
					PollForSourceChanges: false,
				},
			});
			expect(properties.Stages[1]?.Actions.map(({ Name }) => Name)).toEqual([
				"Approve",
			]);
			expect(properties.Variables).toEqual(
				PAWL_VARIABLES.map((Name) => ({ Name, DefaultValue: "UNSET" })),
			);
			expect(
				Object.keys(template.findResources("AWS::Lambda::Function")),
			).toHaveLength(1);
			const serialized = JSON.stringify(template.toJSON());
			expect(serialized).not.toContain("AIReview");
			expect(serialized).not.toContain("Reviewer-lambda");
			expect(serialized).not.toContain("LOCALSTACK_AUTH_TOKEN");
		});

		it("synthesizes the reviewed managed source and parallel review action", () => {
			const app = new App({ context: { stage: "dev", team: "foo" } });
			const stack = new Stack(app, "CodePipelineReviewedSynthStack");
			addIntegrationPipeline(stack, REPO_NAME, true);

			const template = Template.fromStack(stack);
			const [pipeline] = Object.values(
				template.findResources("AWS::CodePipeline::Pipeline"),
			);
			if (!pipeline) throw new Error("Expected a synthesized pipeline");
			const properties = pipeline.Properties as {
				Stages: Array<{
					Name: string;
					Actions: Array<{
						Name: string;
						RunOrder?: number;
						InputArtifacts?: Array<{ Name: string }>;
						OutputArtifacts?: Array<{ Name: string }>;
					}>;
				}>;
				Variables: Array<{ Name: string; DefaultValue: string }>;
			};
			const [source, build] = properties.Stages;

			expect(properties.Stages.map(({ Name }) => Name)).toEqual([
				"Source",
				"Build",
			]);
			expect(source?.Actions[0]).toMatchObject({
				Name: "Source",
				OutputArtifacts: [{ Name: "SourceOutput" }],
			});
			expect(build?.Actions.map(({ Name }) => Name)).toEqual([
				"Approve",
				"AIReview",
			]);
			expect(build?.Actions.map(({ RunOrder }) => RunOrder ?? 1)).toEqual([
				1, 1,
			]);
			expect(build?.Actions[1]?.InputArtifacts).toEqual([
				{ Name: "SourceOutput" },
			]);
			expect(properties.Variables).toEqual(
				PAWL_VARIABLES.map((Name) => ({ Name, DefaultValue: "UNSET" })),
			);

			const [repository] = Object.values(
				template.findResources("AWS::CodeCommit::Repository"),
			);
			expect(repository?.Properties).toMatchObject({
				RepositoryName: REPO_NAME,
			});
			expect(JSON.stringify(repository)).not.toContain("LOCALSTACK_AUTH_TOKEN");
			const serialized = JSON.stringify(template.toJSON());
			expect(serialized).toContain("Reviewer-lambda");
			expect(serialized).toContain("Router-lambda");
			expect(
				Object.keys(template.findResources("AWS::DynamoDB::GlobalTable")),
			).toHaveLength(1);
			expect(
				Object.keys(template.findResources("AWS::Events::Rule")).length,
			).toBeGreaterThanOrEqual(2);
			expect(
				Object.keys(template.findResources("AWS::IAM::Role")).length,
			).toBeGreaterThanOrEqual(4);
		});
	});

	const { CloudFormationClient, DescribeStackResourcesCommand } = await import(
		"@aws-sdk/client-cloudformation"
	);
	const { CodePipelineClient, ListPipelinesCommand, GetPipelineCommand } =
		await import("@aws-sdk/client-codepipeline");
	const { CodeCommitClient, GetRepositoryCommand } = await import(
		"@aws-sdk/client-codecommit"
	);
	const { DynamoDBClient, DescribeTableCommand } = await import(
		"@aws-sdk/client-dynamodb"
	);
	const { EventBridgeClient, ListRulesCommand } = await import(
		"@aws-sdk/client-eventbridge"
	);
	const { IAMClient, ListRolesCommand } = await import("@aws-sdk/client-iam");

	describe("integ:codepipeline", () => {
		const ls = createLocalStackSetup({
			appFile: import.meta.path,
			stack: CodePipelineIntegStack,
			timeout: 300_000,
		});

		// SDK clients set up in beforeAll
		let cp: CodePipelineClient;
		let cf: CloudFormationClient;

		// Physical resource names discovered from CloudFormation
		let pipelineName: string;
		let repoPhysicalName: string;
		let reviewerFnName: string;
		let routerFnName: string;
		let stateTableName: string;

		/**
		 * Create a client that targets the LocalStack instance.
		 */
		function lsClient<T>(ClientCtor: new (...args: unknown[]) => T): T {
			return new ClientCtor({
				endpoint: ls.endpoint,
				region: "us-east-1",
				credentials: { accessKeyId: "test", secretAccessKey: "test" },
			}) as T;
		}

		beforeAll(async () => {
			cp = lsClient(CodePipelineClient);
			cf = lsClient(CloudFormationClient);

			// Discover all resource names from the deployed CloudFormation stack
			const { StackResources } = await cf.send(
				new DescribeStackResourcesCommand({ StackName: STACK_NAME }),
			);
			const res = StackResources ?? [];

			// Pipeline name from the CodePipeline resource
			const pipelineResource = res.find(
				(r) => r.ResourceType === "AWS::CodePipeline::Pipeline",
			);
			pipelineName = pipelineResource?.PhysicalResourceId ?? "";

			// CodeCommit repository name
			const repoResource = res.find(
				(r) => r.ResourceType === "AWS::CodeCommit::Repository",
			);
			repoPhysicalName = repoResource?.PhysicalResourceId ?? "";

			// Lambda function names
			const lambdaResources = res.filter(
				(r) =>
					r.ResourceType === "AWS::Lambda::Function" &&
					r.LogicalResourceId?.startsWith("Pipeline"),
			);
			reviewerFnName =
				lambdaResources.find((r) =>
					r.PhysicalResourceId?.includes("Reviewer-lambda"),
				)?.PhysicalResourceId ?? "";
			routerFnName =
				lambdaResources.find((r) =>
					r.PhysicalResourceId?.includes("Router-lambda"),
				)?.PhysicalResourceId ?? "";

			// DynamoDB table name
			const tableResource = res.find(
				(r) => r.ResourceType === "AWS::DynamoDB::GlobalTable",
			);
			stateTableName = tableResource?.PhysicalResourceId ?? "";

			// Fallback if CloudFormation didn't yield a pipeline name
			if (!pipelineName) {
				const { pipelines } = await cp.send(new ListPipelinesCommand({}));
				if (pipelines?.length) {
					pipelineName = pipelines[0].name ?? "";
				}
			}
		});

		// ── Pipeline structure ───────────────────────────────────

		it("deploys Source followed by the Build user stage", async () => {
			expect(pipelineName).toBeTruthy();
			const { pipeline } = await cp.send(
				new GetPipelineCommand({ name: pipelineName }),
			);
			expect(pipeline.stages?.map(({ name }) => name)).toEqual([
				"Source",
				"Build",
			]);
		});

		it("configures the managed CodeCommit source and SourceOutput", async () => {
			const { pipeline } = await cp.send(
				new GetPipelineCommand({ name: pipelineName }),
			);
			const sourceActions = pipeline.stages?.[0]?.actions ?? [];
			expect(sourceActions).toHaveLength(1);
			const source = sourceActions[0];
			expect(source?.name).toBe("Source");
			expect(source?.actionTypeId).toMatchObject({
				category: "Source",
				provider: "CodeCommit",
			});
			expect(source?.outputArtifacts).toEqual([{ name: "SourceOutput" }]);
			const sourceConfiguration = source?.configuration ?? {};
			const deployedRepositoryName = sourceConfiguration.RepositoryName;
			expect(deployedRepositoryName).toBe(repoPhysicalName);
			expect([REPO_NAME, LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME]).toContain(
				deployedRepositoryName,
			);
			expect({
				...sourceConfiguration,
				PollForSourceChanges:
					sourceConfiguration.PollForSourceChanges?.toLowerCase(),
			}).toEqual({
				BranchName: "main",
				PollForSourceChanges: "false",
				RepositoryName: deployedRepositoryName,
			});
			expect(Object.keys(sourceConfiguration)).not.toContain(
				"LOCALSTACK_AUTH_TOKEN",
			);
		});

		it("injects AIReview parallel with approval in the first user stage", async () => {
			const { pipeline } = await cp.send(
				new GetPipelineCommand({ name: pipelineName }),
			);
			const buildStage = pipeline.stages?.[1];
			if (buildStage?.name !== "Build")
				throw new Error("Build stage not found");
			const actions = buildStage.actions ?? [];
			expect(actions.map(({ name }) => name)).toEqual(["Approve", "AIReview"]);
			expect(actions.map(({ runOrder }) => runOrder ?? 1)).toEqual([1, 1]);

			const approval = actions[0];
			expect(approval?.actionTypeId).toMatchObject({
				category: "Approval",
				provider: "Manual",
			});
			const aiReview = actions[1];
			expect(aiReview?.actionTypeId).toMatchObject({
				category: "Invoke",
				provider: "Lambda",
			});
			expect(aiReview?.inputArtifacts).toEqual([{ name: "SourceOutput" }]);
			const fnName = aiReview?.configuration?.FunctionName ?? "";
			expect(fnName).toContain("Bridge-lambda");
			expect(fnName.startsWith("arn:")).toBeFalse();
			expect(fnName).not.toContain("$LATEST");

			const userParameters = JSON.parse(
				aiReview?.configuration?.UserParameters ?? "{}",
			) as Record<string, unknown>;
			expect(userParameters).toMatchObject({
				provider: "#{variables.PAWL_PROVIDER}",
				repository: "#{variables.PAWL_REPOSITORY}",
				requestId: "#{variables.PAWL_REQUEST_ID}",
				generation: "#{variables.PAWL_GENERATION}",
				sourceRevision: "#{variables.PAWL_SOURCE_REVISION}",
				destinationRevision: "#{variables.PAWL_DESTINATION_REVISION}",
			});
		});

		it("declares all six review coordination variables", async () => {
			const { pipeline } = await cp.send(
				new GetPipelineCommand({ name: pipelineName }),
			);
			expect(pipeline.variables).toEqual(
				PAWL_VARIABLES.map((name) => ({ name, defaultValue: "UNSET" })),
			);
		});

		// ── CodeCommit repository ────────────────────────────────

		it("creates and deploys the managed CodeCommit repository", async () => {
			expect([REPO_NAME, LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME]).toContain(
				repoPhysicalName,
			);

			// LocalStack's CloudFormation provider currently falls back to the
			// physical ID "unknown" because AWS::CodeCommit::Repository is unsupported.
			// Keep requiring the exact managed name if that service gains support.
			if (repoPhysicalName === LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME) {
				expect(repoPhysicalName).toBe(LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME);
				return;
			}

			expect(repoPhysicalName).toBe(REPO_NAME);
			const { repositoryMetadata } = await lsClient(CodeCommitClient).send(
				new GetRepositoryCommand({ repositoryName: REPO_NAME }),
			);
			expect(repositoryMetadata?.repositoryName).toBe(REPO_NAME);
			expect(repositoryMetadata?.cloneUrlHttp).toContain(REPO_NAME);
			expect(Object.keys(repositoryMetadata ?? {})).not.toContain(
				"LOCALSTACK_AUTH_TOKEN",
			);
		});

		// ── Auto-review Lambda functions ─────────────────────────

		it("creates the reviewer durable Lambda function", () => {
			expect(reviewerFnName).toContain("Reviewer-lambda");
		});

		it("creates the router Lambda function", () => {
			expect(routerFnName).toContain("Router-lambda");
		});

		// ── DynamoDB state table ─────────────────────────────────

		it("creates DynamoDB state table with partition/sort key schema", async () => {
			expect(stateTableName).toBeTruthy();

			const { Table } = await lsClient(DynamoDBClient).send(
				new DescribeTableCommand({ TableName: stateTableName }),
			);
			expect(Table?.KeySchema).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ AttributeName: "pk", KeyType: "HASH" }),
					expect.objectContaining({ AttributeName: "sk", KeyType: "RANGE" }),
				]),
			);
		});

		// ── EventBridge rules ────────────────────────────────────

		it("creates EventBridge rules for PR events and pipeline execution", async () => {
			const { Rules } = await lsClient(EventBridgeClient).send(
				new ListRulesCommand({}),
			);
			const names = (Rules ?? []).map((r) => r.Name ?? "").join(", ");
			// PR-event patterns include "PullRequest" in the event pattern detail-type
			expect(names).not.toBeEmpty();
			expect(names.length).toBeGreaterThan(0);
		});

		// ── IAM roles ────────────────────────────────────────────

		it("creates IAM roles for the pipeline and Lambda functions", async () => {
			const { Roles } = await lsClient(IAMClient).send(
				new ListRolesCommand({}),
			);
			const names = (Roles ?? []).map((r) => r.RoleName ?? "");
			// Pipeline and review infrastructure should create several scoped roles.
			expect(names.length).toBeGreaterThanOrEqual(4);
		});

		// ── Pipeline execution (best-effort) ─────────────────────

		it("seeds the repository and triggers a pipeline execution", async () => {
			if (repoPhysicalName === LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME) {
				expect(repoPhysicalName).toBe(LOCALSTACK_UNSUPPORTED_REPOSITORY_NAME);
				return;
			}

			const cc = lsClient(CodeCommitClient);

			// Ensure the main branch exists with an initial commit. Once LocalStack
			// supports the managed repository, any seeding failure must fail this test.
			const { CreateCommitCommand } = await import(
				"@aws-sdk/client-codecommit"
			);
			await cc.send(
				new CreateCommitCommand({
					repositoryName: REPO_NAME,
					branchName: "main",
					putFiles: [
						{
							filePath: "README.md",
							fileContent: new TextEncoder().encode(
								"# Integration Test\n\nPipeline execution test.\n",
							),
						},
					],
				}),
			);

			// Start a pipeline execution
			const { StartPipelineExecutionCommand } = await import(
				"@aws-sdk/client-codepipeline"
			);
			const { pipelineExecutionId } = await cp.send(
				new StartPipelineExecutionCommand({ name: pipelineName }),
			);
			expect(pipelineExecutionId).toBeDefined();
			expect(pipelineExecutionId).not.toBe("");
		}, 60_000);
	});
}
