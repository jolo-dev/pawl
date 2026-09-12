import { describe, expect, test } from "bun:test";
import path from "node:path";
import ts from "typescript";

const packageRoot = path.resolve(import.meta.dir, "..");
const entryPoint = path.join(packageRoot, "index.ts");
// Inspect declarations only: importing the public API would execute CDK modules.
const program = ts.createProgram([entryPoint], {
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
	skipLibCheck: true,
});
const checker = program.getTypeChecker();
const entry = program.getSourceFile(entryPoint);
if (!entry) throw new Error("Missing CDK entry point");
const moduleSymbol = checker.getSymbolAtLocation(entry);
if (!moduleSymbol) throw new Error("Missing CDK module symbol");
const publicClasses = new Map<string, ts.ClassDeclaration>();
for (const exported of checker.getExportsOfModule(moduleSymbol)) {
	const symbol =
		exported.flags & ts.SymbolFlags.Alias
			? checker.getAliasedSymbol(exported)
			: exported;
	for (const declaration of symbol.declarations ?? []) {
		if (
			ts.isClassDeclaration(declaration) &&
			declaration.getSourceFile().fileName.startsWith(`${packageRoot}/src/`)
		) {
			publicClasses.set(exported.name, declaration);
		}
	}
}

const expectedClasses = [
	"AgentCore",
	"ApiDestination",
	"ApiGateway",
	"ApiGatewayV1",
	"AuthoritativeRevisionArbitrationExhaustedError",
	"CodeBuildProject",
	"CodeCommit",
	"CodeCommitAutoReviewer",
	"CodeCommitReviewEvents",
	"CodeCommitSourceLimitError",
	"CodePipeline",
	"DurableLambdaFunction",
	"DynamoDbTable",
	"DynamoDbTableWithStreams",
	"EventBridge",
	"LambdaFunction",
	"LocalStack",
	"PipelineDefinitionError",
	"PipelineReviewDispatcher",
	"Sqs",
	"Stack",
	"StaticSite",
];

// Exact primary-node and condition inventories reject external context and invented resources.
const ownedComponents: Record<
	string,
	{ services: string[]; groups: string[] }
> = {
	AgentCore: {
		services: [
			"asset(disk)[Code asset] in agent",
			"runtime(logos:nodejs-icon)[HTTP runtime Node 22] in agent",
			"endpoint(cloud)[Runtime endpoint] in agent",
		],
		groups: ["agent(cloud)[AgentCore runtime]"],
	},
	ApiDestination: {
		services: [
			"connection(logos:aws-iam)[Connection authentication] in destinationGroup",
			"destination(logos:aws-eventbridge)[API destination] in destinationGroup",
		],
		groups: ["destinationGroup(logos:aws-eventbridge)[API destination]"],
	},
	ApiGatewayV1: {
		services: [
			"logs(logos:aws-cloudwatch)[Access log group]",
			"api(logos:aws-api-gateway)[REST API and prod stage]",
			"routes(logos:aws-api-gateway)[Routes and integrations] in routing",
		],
		groups: ["routing(logos:aws-api-gateway)[When routes are set]"],
	},
	LambdaFunction: {
		services: [
			"bundle(logos:esbuild)[ESM code bundle] in functionGroup",
			"lambda(logos:aws-lambda)[Node 24 ARM64 Lambda] in functionGroup",
		],
		groups: ["functionGroup(logos:aws-lambda)[Lambda function]"],
	},
	DurableLambdaFunction: {
		services: [
			"lambda(logos:aws-lambda)[Durable Node 24 Lambda] in functionGroup",
			"version(logos:aws-lambda)[Published function version] in functionGroup",
			"alias(logos:aws-lambda)[Durable alias] in functionGroup",
		],
		groups: ["functionGroup(logos:aws-lambda)[Durable Lambda function]"],
	},
	DynamoDbTable: {
		services: [
			"table(logos:aws-dynamodb)[On demand table] in tableGroup",
			"indexes(database)[Global secondary indexes] in optionalIndexes",
		],
		groups: [
			"tableGroup(logos:aws-dynamodb)[DynamoDB table]",
			"optionalIndexes(database)[When indexes are configured]",
		],
	},
	DynamoDbTableWithStreams: {
		services: [
			"table(logos:aws-dynamodb)[Table with stream] in streams",
			"mapping(logos:aws-lambda)[DynamoDB event source mapping] in streams",
		],
		groups: ["streams(logos:aws-dynamodb)[DynamoDB stream consumer]"],
	},
	EventBridge: {
		services: [
			"dlq(logos:aws-sqs)[Bus and Lambda delivery DLQ] in mandatory",
			"bus(logos:aws-eventbridge)[EventBridge bus] in mandatory",
			"rules(logos:aws-eventbridge)[Rules and target bindings] in routing",
			"pipe(logos:aws-eventbridge)[Independent Pipe] in pipes",
		],
		groups: [
			"mandatory(logos:aws-eventbridge)[Event bus]",
			"routing(logos:aws-eventbridge)[When rules are configured]",
			"pipes(logos:aws-eventbridge)[When a Pipe is configured]",
		],
	},
	Sqs: {
		services: [
			"queue(logos:aws-sqs)[Main queue] in queues",
			"dlq(logos:aws-sqs)[Retry exhausted DLQ] in queues",
			"mapping(logos:aws-lambda)[Event source mapping batch 10] in queues",
		],
		groups: ["queues(logos:aws-sqs)[Queue and consumer binding]"],
	},
	Stack: {
		services: [
			"stack(logos:aws-cloudformation)[CDK stack] in stackGroup",
			"monitoring(logos:aws-cloudwatch)[MonitoringFacade] in cloudMode",
			"noop(server)[No op monitoring] in localMode",
		],
		groups: [
			"stackGroup(logos:aws-cloudformation)[Assembly root]",
			"cloudMode(logos:aws-cloudwatch)[Outside LOCAL]",
			"localMode(server)[LOCAL truthy]",
		],
	},
	LocalStack: {
		services: [
			"lambda(logos:aws-lambda)[Node 24 LambdaFunction] in entryGroup",
			"url(internet)[Function URL] in entryGroup",
			"outputs(logos:aws-cloudformation)[URL output] in entryGroup",
		],
		groups: ["entryGroup(logos:aws-lambda)[Per directory entry]"],
	},
	StaticSite: {
		services: [
			"headers(logos:aws-cloudfront)[Security headers policy] in siteGroup",
			"cdn(logos:aws-cloudfront)[CloudFront with OAC] in siteGroup",
			"site(logos:aws-s3)[Private versioned site bucket] in siteGroup",
			"logs(logos:aws-s3)[Retained access log bucket] in siteGroup",
		],
		groups: ["siteGroup(logos:aws-cloudfront)[Static site]"],
	},
	CodeBuildProject: {
		services: [
			"placeholder(logos:aws-s3)[Placeholder source bucket] in project",
			"build(logos:aws-codebuild)[Build project] in project",
			"logs(logos:aws-cloudwatch)[Build log group] in project",
			"key(logos:aws-kms)[Rotating encryption key] in project",
			"security(logos:aws-iam)[Security group] in privateNetwork",
		],
		groups: [
			"project(logos:aws-codebuild)[CodeBuild project]",
			"privateNetwork(logos:aws-vpc)[Private networking]",
		],
	},
	CodeCommit: {
		services: [
			"repo(logos:aws-codecommit)[Repository in create mode] in composition",
			"seed(disk)[Seed with sourcePath] in composition",
			"events(logos:aws-eventbridge)[Router mode rules and DLQ] in composition",
			"reviewer(cloud)[AutoReview resources] in composition",
		],
		groups: ["composition(logos:aws-codecommit)[All components conditional]"],
	},
	CodeCommitReviewEvents: {
		services: [
			"pr(logos:aws-eventbridge)[Pull request rule] in native",
			"comments(logos:aws-eventbridge)[PR comment rule] in native",
			"target(logos:aws-lambda)[Lambda target bindings] in native",
			"dlq(logos:aws-sqs)[Encrypted delivery failure DLQ] in native",
			"fallback(logos:aws-eventbridge)[CloudTrail comment rule] in fallbackGroup",
		],
		groups: [
			"native(logos:aws-eventbridge)[Review event delivery]",
			"fallbackGroup(logos:aws-cloudtrail)[When CloudTrail fallback is enabled]",
		],
	},
	CodeCommitAutoReviewer: {
		services: [
			"events(logos:aws-eventbridge)[Review rules and targets] in repositoryResources",
			"dlq(logos:aws-sqs)[Delivery failure DLQ] in repositoryResources",
			"checks(logos:aws-codebuild)[Checks project resources] in repositoryResources",
			"router(logos:aws-lambda)[Router Lambda]",
			"reviewer(logos:aws-lambda)[Durable reviewer and alias]",
			"state(logos:aws-dynamodb)[Review state table]",
			"bridge(logos:aws-lambda)[Bridge Lambda] in coordination",
			"reconciler(logos:aws-lambda)[Reconciler Lambda] in coordination",
			"schedule(logos:aws-eventbridge)[One minute schedule] in coordination",
		],
		groups: [
			"repositoryResources(logos:aws-codecommit)[Per repository]",
			"coordination(logos:aws-codepipeline)[Only active coordination]",
		],
	},
	CodePipeline: {
		services: [
			"pipeline(logos:aws-codepipeline)[V2 pipeline] in composition",
			"source(logos:aws-codecommit)[CodeCommit source action] in composition",
			"actions(logos:aws-codepipeline)[Configured stages and actions] in composition",
			"repo(logos:aws-codecommit)[Optional created repository] in composition",
			"seed(disk)[Optional initial source ZIP asset] in composition",
			"storage(logos:aws-s3)[Optional artifact bucket] in composition",
			"key(logos:aws-kms)[Optional created key] in composition",
			"pr(logos:aws-lambda)[PR routing without reviewer] in composition",
			"reviewer(cloud)[Optional autoReviewer] in composition",
			"execution(logos:aws-eventbridge)[Execution rule only in PR mode] in composition",
			"aiReview(logos:aws-lambda)[AIReview only active PR mode] in composition",
		],
		groups: ["composition(logos:aws-codepipeline)[Configured composition]"],
	},
	CodeCommitSourceLimitError: {
		services: [
			"error(server)[Source limit error] in failure",
			"metadata(disk)[Kind limit actual and optional path] in failure",
		],
		groups: ["failure(server)[Contained error state]"],
	},
	PipelineDefinitionError: {
		services: [
			"error(server)[Pipeline definition error] in errorGroup",
			"details(disk)[Code message and optional path] in errorGroup",
		],
		groups: ["errorGroup(server)[Contained error state]"],
	},
	AuthoritativeRevisionArbitrationExhaustedError: {
		services: ["error(server)[Retryable arbitration error] in failure"],
		groups: ["failure(server)[Contained error state]"],
	},
	PipelineReviewDispatcher: {
		services: [
			"arbitration(server)[Revision arbitration] in implementation",
			"dispatch(server)[Exact revision dispatch] in implementation",
			"mapping(disk)[Execution mapping] in implementation",
			"terminal(server)[Terminal request handling] in implementation",
			"coordination(server)[Review job coordination] in optionalCoordination",
		],
		groups: [
			"implementation(server)[Contained implementation]",
			"optionalCoordination(server)[When coordinateReviewJobs is enabled]",
		],
	},
};

function attachedDocumentation(declaration: ts.ClassDeclaration): string {
	return ts
		.getJSDocCommentsAndTags(declaration)
		.filter(ts.isJSDoc)
		.map((comment) => comment.getText(declaration.getSourceFile()))
		.join("\n")
		.replace(/^\s*\* ?/gm, "");
}

function validateArchitecture(diagram: string): void {
	const lines = diagram
		.trim()
		.split("\n")
		.map((line) => line.trim());
	expect(lines.shift()).toBe("architecture-beta");
	// Services and junctions are valid edge and alignment endpoints.
	const services = new Map<string, string | undefined>();
	const groups = new Map<string, string | undefined>();
	const edges: string[] = [];
	const alignments: string[][] = [];
	for (const line of lines.filter(Boolean)) {
		const declaration = line.match(
			/^(service|group) (\w+)\([\w:-]+\)\[[^\]]+\](?: in (\w+))?$/,
		);
		const junction = line.match(/^junction (\w+)(?: in (\w+))?$/);
		if (junction) {
			const [, id, parent] = junction;
			if (!id) throw new Error(`Missing junction ID: ${line}`);
			expect(services.has(id) || groups.has(id)).toBe(false);
			services.set(id, parent);
		} else if (declaration) {
			const [, kind, id, parent] = declaration;
			if (!id) throw new Error(`Missing declaration ID: ${line}`);
			expect(services.has(id) || groups.has(id)).toBe(false);
			(kind === "service" ? services : groups).set(id, parent);
		} else {
			const alignment = line.match(/^align (?:row|column) (\w+(?: \w+)+)$/);
			if (alignment?.[1]) {
				alignments.push(alignment[1].split(" "));
			} else {
				edges.push(line);
			}
		}
	}
	for (const members of alignments) {
		expect(new Set(members).size).toBe(members.length);
		for (const id of members) expect(services.has(id)).toBe(true);
	}
	expect(services.size).toBeGreaterThan(0);
	for (const parent of [...services.values(), ...groups.values()]) {
		if (parent) expect(groups.has(parent)).toBe(true);
	}
	// A genuine single-node software error needs no invented self-edge.
	if (services.size > 1) expect(edges.length).toBeGreaterThan(0);
	for (const edge of edges) {
		const match = edge.match(
			/^(\w+)(\{group\})?:[LTRB] (?:<)?--(?:>)? [LTRB]:(\w+)(\{group\})?$/,
		);
		if (!match) throw new Error(`Invalid architecture edge: ${edge}`);
		for (const [id, boundary] of [
			[match[1], match[2]],
			[match[3], match[4]],
		]) {
			if (!id) throw new Error(`Missing edge endpoint: ${edge}`);
			expect(services.has(id)).toBe(true);
			if (boundary) {
				const parent = services.get(id);
				expect(parent !== undefined && groups.has(parent)).toBe(true);
			}
		}
	}
}

describe("public CDK class documentation diagrams", () => {
	test("covers exactly the 22 Pawl-owned public classes", () => {
		expect([...publicClasses.keys()].sort()).toEqual(expectedClasses);
	});

	for (const name of expectedClasses) {
		test(`${name} has attached architecture Mermaid with declared endpoints`, () => {
			const declaration = publicClasses.get(name);
			if (!declaration) throw new Error(`Missing public class: ${name}`);
			const documentation = attachedDocumentation(declaration);
			const diagrams = [
				...documentation.matchAll(/```mermaid\s*\n([\s\S]*?)```/g),
			];
			expect(diagrams.length).toBeGreaterThan(0);
			for (const diagram of diagrams) {
				const architecture = diagram[1] ?? "";
				validateArchitecture(architecture);
				expect(architecture).not.toMatch(
					/\[Always (?:created|provisioned)[^\]]*\]/i,
				);
			}
		});
	}

	test("ownership inventories cover every class except the separately tested pilot", () => {
		expect(Object.keys(ownedComponents).sort()).toEqual(
			expectedClasses.filter((name) => name !== "ApiGateway"),
		);
	});

	for (const [name, inventory] of Object.entries(ownedComponents)) {
		test(`${name} contains only its primary owned nodes with honest conditions`, () => {
			const declaration = publicClasses.get(name);
			if (!declaration) throw new Error(`Missing class: ${name}`);
			const documentation = attachedDocumentation(declaration);
			const diagrams = [
				...documentation.matchAll(/```mermaid\s*\n([\s\S]*?)```/g),
			];
			expect(diagrams).toHaveLength(1);
			const diagram = diagrams[0]?.[1] ?? "";
			expect(
				[...diagram.matchAll(/^\s*service (.+)$/gm)]
					.map((match) => match[1])
					.sort(),
			).toEqual([...inventory.services].sort());
			expect(
				[...diagram.matchAll(/^\s*group (.+)$/gm)]
					.map((match) => match[1])
					.sort(),
			).toEqual([...inventory.groups].sort());
			const junctions = [...diagram.matchAll(/^\s*junction (.+)$/gm)].map(
				(match) => match[1],
			);
			expect(junctions).toEqual(
				name === "CodeBuildProject"
					? ["encryption in project", "bindings in project"]
					: [],
			);
		});
	}

	test("documents ownership corner cases rather than implying unconditional deployments", () => {
		const conditions: Record<string, string[]> = {
			AgentCore: [
				"including the DEFAULT endpoint when endpoint options are absent",
			],
			ApiGatewayV1: [
				"log group is always created",
				"configured only outside LOCAL",
			],
			CodeBuildProject: [
				"placeholder S3 bucket",
				"used only in pipeline source mode",
			],
			CodeCommit: ["import-only mode", "no resources", "mutually exclusive"],
			CodeCommitAutoReviewer: [
				"reviewCoordinationDeployment.phase is active",
				"Preparation phases retain",
				"but prepareGsi1",
			],
			CodePipeline: [
				"crossRegionReplicationBuckets",
				"artifactEncryptionKey",
				"is also absent",
				"at least one user stage",
				"Auto-review without PR mode",
				"separate execution node",
			],
			DynamoDbTableWithStreams: [
				"existingTable property",
				"does not import a table",
				"removalPolicy is retain",
			],
			EventBridge: [
				"empty targets create no rules",
				"requires props.secrets",
				"independent Pipe",
			],
			LocalStack: [
				"empty directory creates none",
				"name does not enable LOCAL",
			],
			Stack: ["alternative implementation modes"],
			StaticSite: [
				"No asset upload is provisioned",
				"not identity resources or viewer authentication",
			],
			Sqs: ["does not register monitoring automatically"],
			PipelineReviewDispatcher: [
				"non-provisioning software",
				"coordinateReviewJobs enabled (the default)",
				"required even when coordination is disabled",
			],
			AuthoritativeRevisionArbitrationExhaustedError: [
				"retryable = true",
				"does not arbitrate revisions",
			],
		};
		for (const [name, phrases] of Object.entries(conditions)) {
			const declaration = publicClasses.get(name);
			if (!declaration) throw new Error(`Missing class: ${name}`);
			const documentation = attachedDocumentation(declaration).replace(
				/\s+/g,
				" ",
			);
			for (const phrase of phrases) expect(documentation).toContain(phrase);
		}
		const eventBridge = publicClasses.get("EventBridge");
		if (!eventBridge) throw new Error("Missing EventBridge");
		const diagram =
			attachedDocumentation(eventBridge).match(
				/```mermaid\s*\n([\s\S]*?)```/,
			)?.[1] ?? "";
		expect(diagram).not.toMatch(
			/(?:pipe(?:\{group\})?:[LTRB]|[LTRB]:pipe(?:\{group\})?)/,
		);
	});

	test("accepts a single contained software node without a fake self-edge", () => {
		validateArchitecture(
			"architecture-beta\ngroup state(server)[Error state]\nservice error(server)[Retryable error] in state",
		);
	});

	test("CodeCommit owns its public overview and examples, not its private helper", () => {
		const declaration = publicClasses.get("CodeCommit");
		if (!declaration) throw new Error("Missing CodeCommit class");
		const documentation = attachedDocumentation(declaration);
		expect(documentation).toContain(
			"High-level CodeCommit repository construct",
		);
		expect(documentation).toContain("**Create mode**");
		expect(documentation).toContain("**Import mode**");
		expect(documentation).toContain("@example Create and seed a repository:");
		const helper = declaration
			.getSourceFile()
			.statements.find(
				(statement): statement is ts.ClassDeclaration =>
					ts.isClassDeclaration(statement) &&
					statement.name?.text === "ExistingSourceAssetCode",
			);
		if (!helper) throw new Error("Missing ExistingSourceAssetCode helper");
		expect(attachedDocumentation(helper)).not.toContain(
			"High-level CodeCommit repository construct",
		);
	});

	test("ApiGateway shows only provisioned resource groups and their conditions", () => {
		const declaration = publicClasses.get("ApiGateway");
		if (!declaration) throw new Error("Missing ApiGateway class");
		const documentation = attachedDocumentation(declaration);
		const diagram = documentation.match(/```mermaid\s*\n([\s\S]*?)```/)?.[1];
		if (!diagram) throw new Error("Missing ApiGateway diagram");
		expect(
			[...diagram.matchAll(/^\s*service (\w+)/gm)]
				.map((match) => match[1])
				.sort(),
		).toEqual(["api", "authorizer", "logs", "routes"]);
		for (const resource of [
			"[HTTP API]",
			"[When routes are configured]",
			"[Optional authorizer]",
			"[HTTP API and stage] in mandatory",
			"[Access log group] in mandatory",
			"[Routes and integrations] in routing",
			"[API authorizer] in authorization",
		])
			expect(diagram).toContain(resource);
		expect(documentation).toContain(
			"IAM and no-auth modes do not create an API authorizer resource",
		);
		expect(documentation).toContain(
			"Cognito app client when clients are not supplied",
		);
	});

	for (const name of [
		"CodeBuildProject",
		"CodeCommit",
		"CodeCommitAutoReviewer",
		"CodeCommitReviewEvents",
		"CodePipeline",
		"PipelineReviewDispatcher",
		"Sqs",
		"Stack",
		"StaticSite",
	]) {
		test(`${name} avoids bottom service ports beneath labels`, () => {
			const declaration = publicClasses.get(name);
			if (!declaration) throw new Error(`Missing ${name} class`);
			const diagram = attachedDocumentation(declaration).match(
				/```mermaid\s*\n([\s\S]*?)```/,
			)?.[1];
			if (!diagram) throw new Error(`Missing ${name} diagram`);
			// Group boundaries and unlabeled junctions have no service label below them.
			// Actual intersections still require the browser connector-geometry check.
			for (const [, id] of diagram.matchAll(/^\s*service (\w+)/gm)) {
				expect(diagram).not.toMatch(new RegExp(`\\b${id}:B\\b`));
				expect(diagram).not.toMatch(new RegExp(`B:${id}(?!\\w|\\{group\\})`));
			}
		});
	}

	test("CodeBuildProject connects each dependency directly without crossed top-port bends", () => {
		const declaration = publicClasses.get("CodeBuildProject");
		if (!declaration) throw new Error("Missing CodeBuildProject");
		const documentation = attachedDocumentation(declaration);
		for (const edge of [
			"placeholder:R -- L:build",
			"build:R -- L:bindings",
			"bindings:R -- L:logs",
			"bindings:B -- L:security",
			"key:R -- L:encryption",
			"encryption:B -- T:build",
			"encryption:R -- T:logs",
			"align column encryption build",
			"align column logs security",
		])
			expect(documentation).toContain(edge);
	});

	test("CodeCommitReviewEvents directs every rule into its target binding", () => {
		const declaration = publicClasses.get("CodeCommitReviewEvents");
		if (!declaration) throw new Error("Missing CodeCommitReviewEvents");
		const documentation = attachedDocumentation(declaration);
		for (const rule of ["pr", "comments", "fallback"]) {
			expect(documentation).toContain(`${rule}:R --> L:target`);
		}
		expect(documentation).toContain("target:R -- L:dlq");
		expect(documentation).toContain("align column fallback pr comments");
	});

	test("accepts alignment directives between declared services and junctions", () => {
		validateArchitecture(
			"architecture-beta\nservice a(server)[A]\njunction split\nservice b(server)[B]\na:R -- L:split\nsplit:R --> L:b\nalign row a split b",
		);
		validateArchitecture(
			"architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:R --> L:b\nalign row a b",
		);
		validateArchitecture(
			"architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:B --> T:b\nalign column a b",
		);
	});

	test("rejects other formats and dangling service or group references", () => {
		for (const diagram of [
			"flowchart LR\na --> b",
			"sequenceDiagram\na->>b: call",
			"architecture-beta\nservice a(server)[A]\na:R --> L:missing",
			"architecture-beta\nservice a(server)[A]\njunction a\na:R -- L:a",
			"architecture-beta\njunction a in missing\na:R -- L:a",
			"architecture-beta\njunction a\na:R -- L:missing",
			"architecture-beta\nservice a(server)[A] in missing\na:R --> L:a",
			"architecture-beta\ngroup g(server)[G]\nservice a(server)[A] in g\ng:R --> L:a",
			"architecture-beta\nservice a(server)[A]\na{group}:R --> L:a",
			"architecture-beta\nservice a(server)[A]\na:R --> L:a\nalign row a missing",
			"architecture-beta\nservice a(server)[A]\na:R --> L:a\nalign row a a",
			"architecture-beta\nservice a(server)[A]\na:R --> L:a\nalign row a",
		]) {
			expect(() => validateArchitecture(diagram)).toThrow();
		}
	});
});
