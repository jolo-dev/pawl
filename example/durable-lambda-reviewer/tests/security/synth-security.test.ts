import { describe, expect, test } from "bun:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { DurableLambdaReviewerStack } from "../../stacks/reviewer-stack";

type Statement = {
  Action?: string | string[];
  Effect: string;
  Resource?: unknown;
};

type Resource = Record<string, unknown> & { DeletionPolicy?: string };

function synthesize(repositories: string[] = ["repo-a", "repo-b"], stage = "dev") {
  const app = new App();
  app.node.setContext("team", "jolo");
  app.node.setContext("stage", stage);
  app.node.setContext("repositories", repositories);
  app.node.setContext("reviewerModelId", "anthropic.claude-opus-4-8");
  const stack = new DurableLambdaReviewerStack(app, "SecStack");
  return Template.fromStack(stack);
}

function resourcesOf(template: Template, type: string): Array<[string, Resource]> {
  const found = template.findResources(type) as Record<string, unknown>;
  return Object.entries(found).map(([key, value]) => [key, value as Resource]);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (typeof node.Ref === "string") return `\${${node.Ref}}`;
    const join = node["Fn::Join"];
    if (Array.isArray(join)) {
      const [sep, parts] = join as [string, unknown[]];
      return parts.map(stringify).join(sep);
    }
    if (typeof node["Fn::Sub"] === "string") return node["Fn::Sub"];
    const getAtt = node["Fn::GetAtt"];
    if (Array.isArray(getAtt)) {
      const [resource, attr] = getAtt as [string, string];
      return `\${${resource}.${attr}}`;
    }
  }
  return JSON.stringify(value);
}

/** All IAM policy statements in the synthesized stack. */
function allStatements(template: Template): Statement[] {
  const statements: Statement[] = [];
  for (const [, res] of resourcesOf(template, "AWS::IAM::Policy")) {
    const docs = (res.Properties as { PolicyDocument?: { Statement?: Statement[] } }).PolicyDocument
      ?.Statement;
    if (Array.isArray(docs)) statements.push(...docs);
  }
  for (const [, res] of resourcesOf(template, "AWS::IAM::ManagedPolicy")) {
    const docs = (res.Properties as { PolicyDocument?: { Statement?: Statement[] } }).PolicyDocument
      ?.Statement;
    if (Array.isArray(docs)) statements.push(...docs);
  }
  return statements;
}

function actionsOf(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action as string];
}

/** Pawl-owned wildcard actions that are permitted to use Resource: "*". */
const ALLOWED_WILDCARD_ACTIONS = new Set([
  "lambda:SendDurableExecutionCallbackSuccess",
  "lambda:SendDurableExecutionCallbackFailure",
  "lambda:SendDurableExecutionCallbackHeartbeat",
]);

describe("synth security review", () => {
  test("no unapproved wildcard IAM resources", () => {
    const template = synthesize();
    const wildcard = allStatements(template).filter((s) => stringify(s.Resource) === "*");
    // Every "*" resource statement must be a Pawl-owned callback grant.
    for (const stmt of wildcard) {
      for (const action of actionsOf(stmt)) {
        expect(ALLOWED_WILDCARD_ACTIONS.has(action)).toBe(true);
      }
    }
    // No codebuild/codecommit/dynamodb/logs wildcard resources.
    const serviceWildcards = allStatements(template).filter(
      (s) =>
        actionsOf(s).some((a) => a.startsWith("codebuild:")) ||
        actionsOf(s).some((a) => a.startsWith("codecommit:")) ||
        actionsOf(s).some((a) => a.startsWith("dynamodb:")) ||
        actionsOf(s).some((a) => a.startsWith("logs:")),
    );
    for (const stmt of serviceWildcards) {
      expect(stringify(stmt.Resource)).not.toBe("*");
    }
  });

  test("CodeBuild project environment carries no secrets and only non-secret PAWL_* vars", () => {
    const template = synthesize();
    const projects = resourcesOf(template, "AWS::CodeBuild::Project");
    expect(projects.length).toBeGreaterThan(0);
    for (const [, project] of projects) {
      const env =
        (
          project.Properties as {
            Environment?: { EnvironmentVariables?: Array<{ Name: string; Value: string }> };
          }
        ).Environment?.EnvironmentVariables ?? [];
      const names = env.map((v) => v.Name);
      // No credential/secret env vars.
      for (const name of names) {
        expect(name.toUpperCase()).not.toContain("SECRET");
        expect(name.toUpperCase()).not.toContain("TOKEN");
        expect(name.toUpperCase()).not.toContain("PASSWORD");
        expect(name.toUpperCase()).not.toContain("AWS_ACCESS");
      }
      // Approved-registry package access is configured.
      expect(names).toContain("PAWL_PACKAGE_ACCESS_MODE");
      expect(names).toContain("PAWL_APPROVED_REGISTRY_ENDPOINT");
      // No REPOSITORY_NAME leaked into the build environment.
      expect(names).not.toContain("REPOSITORY_NAME");
    }
  });

  test("every EventBridge rule targets the router via a DLQ", () => {
    const template = synthesize();
    const rules = resourcesOf(template, "AWS::Events::Rule");
    expect(rules.length).toBeGreaterThan(0);
    for (const [, rule] of rules) {
      const targets = (rule.Properties as { Targets: Array<Record<string, unknown>> }).Targets;
      expect(targets).toHaveLength(1);
      const dlq = (targets[0] as { DeadLetterConfig?: { Arn?: unknown } }).DeadLetterConfig?.Arn;
      expect(dlq).toBeDefined();
    }
    // At least one SQS DLQ exists.
    expect(resourcesOf(template, "AWS::SQS::Queue").length).toBeGreaterThan(0);
  });

  test("CloudWatch alarms and a dashboard exist", () => {
    const template = synthesize();
    expect(resourcesOf(template, "AWS::CloudWatch::Alarm").length).toBeGreaterThan(0);
    expect(resourcesOf(template, "AWS::CloudWatch::Dashboard").length).toBe(1);
  });

  test("the public-test CodeBuild network policy is rejected in prod", () => {
    // Synthesizing with stage=prod + the default public-test policy must throw
    // (Pawl enforces this). The default reviewerCodeBuildRegistryEndpoint is
    // still supplied; the failure is the network policy, not the endpoint.
    expect(() => synthesize(["repo-a"], "prod")).toThrow(/public-test/);
  });

  test("the state table has PITR enabled", () => {
    const template = synthesize();
    const tables = resourcesOf(template, "AWS::DynamoDB::GlobalTable");
    expect(tables).toHaveLength(1);
    const replicas = (
      tables[0][1].Properties as {
        Replicas: Array<{
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: boolean };
        }>;
      }
    ).Replicas;
    for (const replica of replicas) {
      expect(replica.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled).toBe(true);
    }
  });
});
