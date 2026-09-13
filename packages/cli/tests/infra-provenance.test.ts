import { describe, expect, test } from "bun:test";
import {
	PAWL_NAME_SUFFIXES,
	parsePawlName,
	parsePawlTagProvenance,
} from "../src/infra/provenance";

describe("parsePawlName", () => {
	test("recovers team, stage, construct id and construct kind", () => {
		expect(parsePawlName("platform-dev-myapi-lambda")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myapi",
			kind: "LambdaFunction",
		});
	});

	test("handles a hyphenated construct id", () => {
		expect(parsePawlName("platform-prod-order-worker-sqs")).toEqual({
			team: "platform",
			stage: "prod",
			constructId: "order-worker",
			kind: "Sqs",
		});
	});

	test("handles the AgentCore underscore-sanitised form", () => {
		// AgentCore replaces every [^a-zA-Z0-9_] with "_" before truncating.
		expect(parsePawlName("platform_dev_myid_agentcore")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myid",
			kind: "AgentCore",
		});
	});

	test("parses the ApiGateway log-group path form", () => {
		// BasicConstruct's prefix keeps its trailing hyphen, so the real name
		// contains "-/" at the boundary.
		expect(parsePawlName("/aws/pawl/platform-dev-/myapi/logs")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myapi",
			kind: "ApiGatewayLogGroup",
		});
	});

	test("parses the ApiGatewayV1 log-group path form", () => {
		expect(parsePawlName("/aws/vendedlogs/platform-dev-/myapi/logs")).toEqual({
			team: "platform",
			stage: "dev",
			constructId: "myapi",
			kind: "ApiGatewayV1LogGroup",
		});
	});

	test("strips a fifo suffix before matching", () => {
		expect(parsePawlName("platform-dev-orders-sqs.fifo")?.constructId).toBe(
			"orders",
		);
	});

	test("marks -dlq as ambiguous rather than guessing", () => {
		expect(parsePawlName("platform-dev-orders-dlq")?.kind).toBe("AmbiguousDlq");
	});

	test("rejects a name with no pawl suffix", () => {
		expect(parsePawlName("my-random-bucket")).toBeNull();
	});

	test("rejects a name with an unknown stage", () => {
		expect(parsePawlName("platform-staging-myapi-lambda")).toBeNull();
	});

	test("rejects a name with no construct id", () => {
		expect(parsePawlName("platform-dev-lambda")).toBeNull();
	});

	test("does not treat a bare prefix as a match", () => {
		expect(parsePawlName("platform-dev")).toBeNull();
	});
});

describe("parsePawlTagProvenance", () => {
	test("reads team and stage from tags when the name carries no convention", () => {
		expect(parsePawlTagProvenance({ team: "platform", stage: "qa" })).toEqual({
			team: "platform",
			stage: "qa",
		});
	});

	test("returns null when a tag is missing", () => {
		expect(parsePawlTagProvenance({ team: "platform" })).toBeNull();
	});

	test("returns null for an unknown stage", () => {
		expect(
			parsePawlTagProvenance({ team: "platform", stage: "staging" }),
		).toBeNull();
	});

	test("is case-insensitive about tag keys", () => {
		expect(parsePawlTagProvenance({ Team: "platform", Stage: "prod" })).toEqual(
			{ team: "platform", stage: "prod" },
		);
	});
});

describe("PAWL_NAME_SUFFIXES", () => {
	test("every suffix maps to a construct name and a resource kind", () => {
		for (const [suffix, entry] of Object.entries(PAWL_NAME_SUFFIXES)) {
			expect(suffix.startsWith("-")).toBe(true);
			expect(entry.construct.length).toBeGreaterThan(0);
			expect(entry.resourceKind.length).toBeGreaterThan(0);
		}
	});

	test("matches the longest suffix first", () => {
		// -appsync-event-api must not be claimed by a shorter -api style suffix.
		expect(parsePawlName("platform-dev-events-appsync-event-api")?.kind).toBe(
			"Websocket",
		);
	});
});
