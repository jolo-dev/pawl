/**
 * The IAM surface a resource scan needs, and the policy that grants it.
 *
 * This module is the single source of truth: the committed policy file is
 * generated from it, and `tests/iam-policy.test.ts` parses the scanner sources
 * and fails when either side drifts. Adding a scanner therefore cannot quietly
 * leave the documented policy short of a permission it needs.
 *
 * Most actions follow the command name, but three do not, and a mechanical
 * mapping would be wrong in a way that fails silently at runtime:
 *
 * - **API Gateway** exposes reads as `apigateway:GET`. `apigateway:GetApis` is
 *   not a real action, so a derived policy would grant nothing.
 * - **S3** lists buckets with `s3:ListAllMyBuckets`, not `s3:ListBuckets`.
 * - **`sts:GetCallerIdentity`** requires no permission at all, so listing it
 *   would overstate the grant a user actually has to make.
 */

/** Command class name -> IAM action, or `null` when the call needs no permission. */
export const COMMAND_ACTIONS: Record<string, string | null> = {
	ListFunctionsCommand: "lambda:ListFunctions",
	ListTagsCommand: "lambda:ListTags",
	DescribeTableCommand: "dynamodb:DescribeTable",
	ListTablesCommand: "dynamodb:ListTables",
	ListTagsOfResourceCommand: "dynamodb:ListTagsOfResource",
	GetApisCommand: "apigateway:GET",
	GetRestApisCommand: "apigateway:GET",
	GetTagsCommand: "apigateway:GET",
	ListQueuesCommand: "sqs:ListQueues",
	GetQueueAttributesCommand: "sqs:GetQueueAttributes",
	ListQueueTagsCommand: "sqs:ListQueueTags",
	ListBucketsCommand: "s3:ListAllMyBuckets",
	GetBucketTaggingCommand: "s3:GetBucketTagging",
	ListEventBusesCommand: "events:ListEventBuses",
	ListTagsForResourceCommand: "events:ListTagsForResource",
	// AWS documents GetCallerIdentity as requiring no permissions.
	GetCallerIdentityCommand: null,
};

/** Sorted so the generated file does not churn between runs. */
export function requiredActions(commands: Iterable<string>): string[] {
	const actions = new Set<string>();
	for (const command of commands) {
		const action = COMMAND_ACTIONS[command];
		if (action) actions.add(action);
	}
	return [...actions].sort();
}

/** Every action the scan needs, longest-lived form of the same list. */
export const PAWL_READONLY_ACTIONS: string[] = requiredActions(
	Object.keys(COMMAND_ACTIONS),
);

export interface PolicyStatement {
	readonly Sid: string;
	readonly Effect: "Allow";
	readonly Action: readonly string[];
	/**
	 * `*` because the read-only list calls do not support resource-level
	 * restrictions. The actions themselves are what bounds this grant.
	 */
	readonly Resource: string;
}

export interface PolicyDocument {
	readonly Version: string;
	readonly Statement: readonly PolicyStatement[];
}

export function buildPolicyDocument(
	actions: readonly string[],
): PolicyDocument {
	return {
		Version: "2012-10-17",
		Statement: [
			{
				Sid: "PawlReadOnlyResourceScan",
				Effect: "Allow",
				Action: [...actions].sort(),
				Resource: "*",
			},
		],
	};
}

const ALIAS_PATTERN = /\b([A-Z]\w*Command)\s+as\s+([A-Z]\w*)\b/g;
const CALL_PATTERN = /\bnew\s+([A-Z]\w*Command)\s*\(/g;

/**
 * Command class names issued by the given sources, with import aliases resolved.
 *
 * Aliases matter: `apigateway.ts` imports the same `GetTagsCommand` under two
 * different local names, so reading call sites alone would record names that do
 * not exist.
 */
export function commandsUsedInSources(sources: readonly string[]): Set<string> {
	const commands = new Set<string>();
	for (const source of sources) {
		const aliases = new Map<string, string>();
		for (const match of source.matchAll(ALIAS_PATTERN)) {
			const [, original, alias] = match;
			if (original && alias) aliases.set(alias, original);
		}
		for (const match of source.matchAll(CALL_PATTERN)) {
			const callSite = match[1];
			if (!callSite) continue;
			commands.add(aliases.get(callSite) ?? callSite);
		}
	}
	return commands;
}
