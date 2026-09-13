/**
 * Pawl provenance: recovering which construct should have created a deployed
 * resource.
 *
 * `BasicConstruct` sets `prefix = "{team}-{stage}-"` (iterating `BasicTags`
 * keys in order) and tags every resource with `team` and `stage`. Constructs
 * then pin physical names as `{prefix}{constructId}-{suffix}`, so a deployed
 * resource's own name identifies the construct that produced it.
 *
 * This module is deliberately pure — no AWS SDK, no I/O — because it is the
 * identity decision the whole analysis rests on, and it must be testable
 * without an account.
 *
 * Two shapes do not follow the convention and are handled explicitly:
 * `AgentCore` sanitises the name (`[^a-zA-Z0-9_]` -> `_`, truncated to 48),
 * and the ApiGateway log groups use a path form
 * (`/aws/pawl/{prefix}/{id}/logs`) whose prefix keeps its trailing hyphen.
 */

/** Deployment stages a Pawl project can carry. Mirrors `BasicTags.shape.stage`. */
export type Stage = "dev" | "qa" | "prod";

/** The construct a deployed resource's name attributes it to. */
export type PawlResourceKind =
	| "LambdaFunction"
	| "ApiGateway"
	| "DynamoDbTable"
	| "Sqs"
	| "AmbiguousDlq"
	| "CodePipeline"
	| "Websocket"
	| "AgentCore"
	| "ApiGatewayLogGroup"
	| "ApiGatewayV1LogGroup";

export interface PawlProvenance {
	readonly team: string;
	readonly stage: Stage;
	readonly constructId: string;
	readonly kind: PawlResourceKind;
}

export interface PawlTagProvenance {
	readonly team: string;
	readonly stage: Stage;
}

export interface PawlNameSuffix {
	/** The Pawl construct that produces this suffix. */
	readonly construct: string;
	/** CloudFormation resource type, for reporting and suggestions. */
	readonly resourceKind: string;
	/**
	 * True when the suffix alone cannot identify the producing construct, so a
	 * caller must disambiguate from tags or the resource's own type.
	 */
	readonly ambiguous?: boolean;
}

const STAGES: readonly Stage[] = ["dev", "qa", "prod"];

/**
 * Suffix table, matched longest-first. Every suffix here comes from a template
 * literal in `packages/cdk/src`; do not add one without a construct that emits it.
 */
export const PAWL_NAME_SUFFIXES: Record<string, PawlNameSuffix> = {
	"-lambda": {
		construct: "LambdaFunction",
		resourceKind: "AWS::Lambda::Function",
	},
	"-apigateway": {
		construct: "ApiGateway",
		resourceKind: "AWS::ApiGatewayV2::Api",
	},
	"-table": {
		construct: "DynamoDbTable",
		resourceKind: "AWS::DynamoDB::Table",
	},
	"-sqs": { construct: "Sqs", resourceKind: "AWS::SQS::Queue" },
	"-dlq": {
		construct: "Sqs",
		resourceKind: "AWS::SQS::Queue",
		ambiguous: true,
	},
	"-pipeline": {
		construct: "CodePipeline",
		resourceKind: "AWS::CodePipeline::Pipeline",
	},
	"-appsync-event-api": {
		construct: "Websocket",
		resourceKind: "AWS::AppSync::GraphQLApi",
	},
	"-agentcore": {
		construct: "AgentCore",
		resourceKind: "AWS::BedrockAgentCore::Runtime",
	},
};

/** Suffixes ordered longest-first so `-appsync-event-api` beats any shorter match. */
const SUFFIXES_LONGEST_FIRST = Object.keys(PAWL_NAME_SUFFIXES).sort(
	(a, b) => b.length - a.length,
);

const LOG_GROUP_FORMS: ReadonlyArray<{
	readonly pattern: RegExp;
	readonly kind: PawlResourceKind;
}> = [
	{
		pattern: /^\/aws\/pawl\/(?<prefix>[^/]+)\/(?<id>[^/]+)\/logs$/,
		kind: "ApiGatewayLogGroup",
	},
	{
		pattern: /^\/aws\/vendedlogs\/(?<prefix>[^/]+)\/(?<id>[^/]+)\/logs$/,
		kind: "ApiGatewayV1LogGroup",
	},
];

function asStage(value: string | undefined): Stage | null {
	return value && (STAGES as readonly string[]).includes(value)
		? (value as Stage)
		: null;
}

/** Split `{team}-{stage}-{constructId}` from the left, keeping the id intact. */
function splitPrefix(
	head: string,
): { team: string; stage: Stage; constructId: string } | null {
	const parts = head.split("-");
	if (parts.length < 3) return null;
	const [team, stagePart, ...idParts] = parts;
	const stage = asStage(stagePart);
	if (!team || !stage) return null;
	const constructId = idParts.join("-");
	if (!constructId) return null;
	return { team, stage, constructId };
}

/**
 * Recover the Pawl construct a deployed resource's physical name attributes it
 * to. Returns `null` for a name that does not follow the convention — a
 * `null` here means "not provably Pawl's", never "not Pawl's".
 */
export function parsePawlName(name: string): PawlProvenance | null {
	for (const { pattern, kind } of LOG_GROUP_FORMS) {
		const match = pattern.exec(name);
		const prefix = match?.groups?.prefix;
		const id = match?.groups?.id;
		if (!prefix || !id) continue;
		// The prefix keeps its trailing hyphen, which produces an empty tail.
		const parts = prefix.split("-").filter((part) => part.length > 0);
		const [team, stagePart] = parts;
		const stage = asStage(stagePart);
		if (!team || !stage) return null;
		return { team, stage, constructId: id, kind };
	}

	// AgentCore replaces `-` with `_`, so normalise it back before matching.
	const normalised = name.replace(/_/g, "-");
	const fifoStripped = normalised.endsWith(".fifo")
		? normalised.slice(0, -".fifo".length)
		: normalised;

	for (const suffix of SUFFIXES_LONGEST_FIRST) {
		if (!fifoStripped.endsWith(suffix)) continue;
		const head = fifoStripped.slice(0, -suffix.length);
		if (!head) continue;
		const split = splitPrefix(head);
		if (!split) continue;
		const entry = PAWL_NAME_SUFFIXES[suffix];
		if (!entry) continue;
		return {
			...split,
			kind: entry.ambiguous
				? "AmbiguousDlq"
				: (entry.construct as PawlResourceKind),
		};
	}

	return null;
}

/**
 * Read Pawl ownership from `team`/`stage` tags alone.
 *
 * This is the only provenance available for constructs that take their physical
 * name from props rather than the prefix — `CodeBuildProject` and `CodeCommit`
 * today. It establishes ownership, not identity: it cannot name the construct.
 */
export function parsePawlTagProvenance(
	tags: Record<string, string | undefined>,
): PawlTagProvenance | null {
	const lookup = new Map(
		Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]),
	);
	const team = lookup.get("team");
	const stage = asStage(lookup.get("stage"));
	if (!team || !stage) return null;
	return { team, stage };
}
