import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	buildPolicyDocument,
	COMMAND_ACTIONS,
	commandsUsedInSources,
	PAWL_READONLY_ACTIONS,
	requiredActions,
} from "../src/infra/scan/policy";

const CLI_ROOT = join(import.meta.dir, "..");

async function scannerSources(): Promise<string[]> {
	const glob = new Bun.Glob("src/infra/scan/*.ts");
	const sources: string[] = [];
	for await (const file of glob.scan(CLI_ROOT)) {
		sources.push(await Bun.file(join(CLI_ROOT, file)).text());
	}
	sources.push(
		await Bun.file(join(CLI_ROOT, "src/infra/project-scan.ts")).text(),
	);
	return sources;
}

describe("COMMAND_ACTIONS", () => {
	test("covers every command the scanners actually issue", async () => {
		const commands = commandsUsedInSources(await scannerSources());

		// If this fails, a scanner was added or changed and the policy no longer
		// describes what pawl asks for.
		const unmapped = [...commands].filter(
			(command) => !(command in COMMAND_ACTIONS),
		);
		expect(unmapped).toEqual([]);
	});

	test("does not carry entries no scanner uses", async () => {
		const commands = commandsUsedInSources(await scannerSources());
		const unused = Object.keys(COMMAND_ACTIONS).filter(
			(command) => !commands.has(command),
		);

		expect(unused).toEqual([]);
	});

	test("resolves import aliases rather than trusting the call-site name", () => {
		// apigateway.ts imports the same GetTagsCommand under two aliases; a naive
		// extractor would record the aliases and miss the real command entirely.
		const source = [
			'import { GetTagsCommand as GetApiTagsCommand } from "@aws-sdk/client-apigatewayv2";',
			"const a = new GetApiTagsCommand({});",
		].join("\n");

		expect([...commandsUsedInSources([source])]).toEqual(["GetTagsCommand"]);
	});
});

describe("action mapping", () => {
	test("maps api gateway reads to its REST-style action", () => {
		// API Gateway exposes reads as apigateway:GET. Deriving the action from the
		// command name yields apigateway:GetApis, which is not a real IAM action and
		// would grant nothing.
		expect(COMMAND_ACTIONS.GetApisCommand).toBe("apigateway:GET");
		expect(COMMAND_ACTIONS.GetRestApisCommand).toBe("apigateway:GET");
		expect(COMMAND_ACTIONS.GetTagsCommand).toBe("apigateway:GET");
	});

	test("maps s3 bucket listing to ListAllMyBuckets", () => {
		expect(COMMAND_ACTIONS.ListBucketsCommand).toBe("s3:ListAllMyBuckets");
	});

	test("records that caller identity needs no permission", () => {
		// sts:GetCallerIdentity is one of the few actions AWS allows unconditionally,
		// so listing it would overstate the grant that is actually required.
		expect(COMMAND_ACTIONS.GetCallerIdentityCommand).toBeNull();
		expect(PAWL_READONLY_ACTIONS).not.toContain("sts:GetCallerIdentity");
	});
});

describe("the committed policy", () => {
	test("matches the actions the scanners imply", async () => {
		const committed = await Bun.file(
			join(CLI_ROOT, "iam/pawl-readonly-policy.json"),
		).json();

		expect(committed).toEqual(
			buildPolicyDocument(requiredActions(Object.keys(COMMAND_ACTIONS))),
		);
	});

	test("allows only read verbs, and never a wildcard action", () => {
		const document = buildPolicyDocument(PAWL_READONLY_ACTIONS);
		const readVerb = /^(Describe|List|Get)[A-Za-z]+$/;
		const actions = document.Statement.flatMap((s) => s.Action);

		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) {
			const [service, verb] = action.split(":");
			expect(service).toBeTruthy();
			expect(verb === "GET" || readVerb.test(verb ?? "")).toBe(true);
			expect(action).not.toContain("*");
		}
	});

	test("is a single allow statement with no wildcard action", () => {
		const document = buildPolicyDocument(PAWL_READONLY_ACTIONS);

		expect(document.Version).toBe("2012-10-17");
		expect(document.Statement).toHaveLength(1);
		expect(document.Statement[0]?.Effect).toBe("Allow");
		for (const action of document.Statement[0]?.Action ?? []) {
			expect(action).not.toBe("*");
		}
	});

	test("lists actions in a stable order so the file does not churn", () => {
		const document = buildPolicyDocument(PAWL_READONLY_ACTIONS);
		const actions = document.Statement[0]?.Action ?? [];

		expect([...actions]).toEqual([...actions].sort());
	});
});
