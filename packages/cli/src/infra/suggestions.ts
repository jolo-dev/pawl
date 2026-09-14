/**
 * Deterministic suggestions: which pawl construct would manage a resource that
 * pawl is not already managing.
 *
 * The rule is deliberately narrow. A resource is a candidate only when it
 * carries **no pawl provenance at all** — not a pawl-shaped name and not the
 * `team`/`stage` tags. Anything pawl already created is a drift question, not a
 * suggestion question.
 *
 * The highest-value case is a resource the project *does* declare: a hand-rolled
 * CDK app using `aws-cdk-lib` matches its own deployment, so a drift report says
 * nothing about it, yet those are exactly the resources worth moving onto pawl.
 * That is why `declaredInProject` is carried rather than filtered on.
 *
 * These rules supply candidates and facts. Ranking and explanation are the
 * model's job — see the `infra-auditor` subagent.
 */

import type { DriftEntry } from "./drift";

export interface ConstructRecommendation {
	/** The pawl construct that would manage this resource. */
	readonly construct: string;
	/** Why, in one sentence, for the user. */
	readonly rationale: string;
	/** Present when the construct only fits some resources of this kind. */
	readonly caveat?: string | undefined;
}

/**
 * CloudFormation type -> the pawl construct for it.
 *
 * Only kinds with a real opinionated pawl construct belong here. Kinds that
 * `@pawl/cdk` merely re-exports from `aws-cdk-lib` (Cognito user pools,
 * `SecretValue`) are absent on purpose: there is nothing to adopt.
 */
export const CONSTRUCT_BY_RESOURCE_KIND: Record<
	string,
	ConstructRecommendation
> = {
	"AWS::Lambda::Function": {
		construct: "LambdaFunction",
		rationale:
			"LambdaFunction is pawl's opinionated Lambda: powertools wiring, IAM and observability instead of assembling them per function.",
	},
	"AWS::ApiGatewayV2::Api": {
		construct: "ApiGateway",
		rationale:
			"ApiGateway provisions routes with least-privilege permissions and alarms attached.",
		caveat:
			"Use Websocket instead when this API is a WebSocket or AppSync Events API.",
	},
	"AWS::ApiGateway::RestApi": {
		construct: "ApiGatewayV1",
		rationale:
			"ApiGatewayV1 brings pawl's guardrails to REST APIs that need v1-only features.",
	},
	"AWS::DynamoDB::Table": {
		construct: "DynamoDbTable",
		rationale:
			"DynamoDbTable applies pawl's required table configuration; DynamoDbTableWithStreams adds the stream wiring.",
	},
	"AWS::SQS::Queue": {
		construct: "Sqs",
		rationale:
			"Sqs creates the queue together with its dead-letter queue and alarms.",
	},
	"AWS::SNS::Topic": {
		construct: "SnsTopic",
		rationale: "SnsTopic applies pawl's topic configuration and subscriptions.",
	},
	"AWS::S3::Bucket": {
		construct: "StaticSite",
		rationale:
			"pawl's only S3 construct is StaticSite, which provisions a site bucket plus its CloudFront distribution and access-log bucket.",
		caveat:
			"Only suitable if this bucket serves a static site; pawl has no generic bucket construct.",
	},
	"AWS::Events::EventBus": {
		construct: "EventBridge",
		rationale:
			"EventBridge creates the bus with its dead-letter queue and the permissions to publish to it.",
	},
	"AWS::CodePipeline::Pipeline": {
		construct: "CodePipeline",
		rationale:
			"CodePipeline builds the pipeline from pawl's fluent stage and action API rather than raw stage definitions.",
	},
	"AWS::CodeBuild::Project": {
		construct: "CodeBuildProject",
		rationale:
			"CodeBuildProject applies pawl's deterministic build configuration and logging.",
	},
	"AWS::CodeCommit::Repository": {
		construct: "CodeCommit",
		rationale:
			"CodeCommit adds pawl's repository settings and, optionally, the durable reviewer.",
	},
	"AWS::BedrockAgentCore::Runtime": {
		construct: "AgentCore",
		rationale: "AgentCore is pawl's opinionated Bedrock agent runtime.",
	},
	"AWS::AppSync::Api": {
		construct: "Websocket",
		rationale:
			"Websocket provisions the AppSync Events API and its channel namespace wiring.",
	},
};

export interface Suggestion {
	readonly construct: string;
	readonly resourceKind: string;
	readonly service: string;
	/** The deployed resource's name, so the user can recognise it. */
	readonly resourceName: string;
	readonly rationale: string;
	readonly caveat?: string | undefined;
	/** True when this project's code declares the resource, but not with pawl. */
	readonly declaredInProject: boolean;
}

/**
 * Candidates from a drift report, in report order.
 *
 * A `not-deployed` entry has no deployed side, and an entry with provenance is
 * already pawl's, so both are skipped.
 */
export function suggestConstructs(
	entries: readonly DriftEntry[],
): Suggestion[] {
	const suggestions: Suggestion[] = [];
	for (const entry of entries) {
		const deployed = entry.deployed;
		if (!deployed) continue;
		if (entry.provenance) continue;

		const recommendation = CONSTRUCT_BY_RESOURCE_KIND[deployed.resourceKind];
		if (!recommendation) continue;

		suggestions.push({
			construct: recommendation.construct,
			resourceKind: deployed.resourceKind,
			service: deployed.service,
			resourceName: deployed.physicalName,
			rationale: recommendation.rationale,
			caveat: recommendation.caveat,
			declaredInProject: entry.status === "matched",
		});
	}
	return suggestions;
}

export function summarizeSuggestions(
	suggestions: readonly Suggestion[],
): { construct: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const suggestion of suggestions) {
		counts.set(
			suggestion.construct,
			(counts.get(suggestion.construct) ?? 0) + 1,
		);
	}
	return [...counts.entries()]
		.map(([construct, count]) => ({ construct, count }))
		.sort(
			(a, b) => b.count - a.count || a.construct.localeCompare(b.construct),
		);
}
