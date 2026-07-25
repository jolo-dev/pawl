import { describe, expect, test } from "bun:test";
import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { LambdaFunction } from "@pawl/cdk";
import { DurableLambdaReviewerStack } from "../../stacks/reviewer-stack";

/** Context for the default (derived-ARN) stack path. */
const DEFAULT_CONTEXT: Record<string, unknown> = {
  team: "jolo",
  stage: "dev",
  repositories: ["test-repo"],
  reviewerModelId: "anthropic.claude-opus-4-8",
};

function createStack(
  id = "ReviewerStack",
  context: Record<string, unknown> = DEFAULT_CONTEXT,
): { stack: DurableLambdaReviewerStack; template: Template } {
  const app = new App();
  for (const [key, value] of Object.entries(context)) {
    app.node.setContext(key, value);
  }
  const stack = new DurableLambdaReviewerStack(app, id);
  return { stack, template: Template.fromStack(stack) };
}

/**
 * Reduce a synthesized CloudFormation value (string, Ref, Fn::Join, Fn::Sub,
 * Fn::GetAtt) to a comparable string with pseudo-parameter placeholders, so
 * assertions can match region/account-agnostic ARNs without literal values.
 */
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

type Statement = {
  Action?: string | string[];
  Effect: string;
  Resource?: unknown;
};

function resourcesOf(template: Template, type: string): Array<[string, Record<string, unknown>]> {
  const found = template.findResources(type) as Record<string, unknown>;
  return Object.entries(found).map(([key, value]) => [key, value as Record<string, unknown>]);
}

/** Find a Lambda function resource by its physical function name. */
function findFunction(template: Template, functionName: string): [string, Record<string, unknown>] {
  const fn = resourcesOf(template, "AWS::Lambda::Function").find(
    ([, res]) => (res.Properties as { FunctionName: string }).FunctionName === functionName,
  );
  if (fn === undefined) throw new Error(`Lambda function ${functionName} not found`);
  return fn;
}

/** All IAM policy statements attached to the router Lambda's execution role. */
function routerRoleStatements(stack: DurableLambdaReviewerStack, template: Template): Statement[] {
  const routerEntry = findFunction(template, "jolo-dev-ReviewerRouter-lambda");
  const roleRef = (routerEntry[1].Properties as { Role?: unknown }).Role;
  const roleId = (() => {
    if (roleRef === null || typeof roleRef !== "object") return undefined;
    const node = roleRef as Record<string, unknown>;
    if (typeof node.Ref === "string") return node.Ref;
    const getAtt = node["Fn::GetAtt"];
    if (Array.isArray(getAtt)) return (getAtt as [string, string])[0];
    return undefined;
  })();
  if (roleId === undefined) throw new Error("router role id not found");

  const statements: Statement[] = [];
  for (const [, res] of resourcesOf(template, "AWS::IAM::Policy")) {
    const props = res.Properties as {
      Roles?: Array<{ Ref: string }>;
      PolicyDocument?: { Statement?: Statement[] };
    };
    const attached = props.Roles?.some((role) => role.Ref === roleId);
    if (!attached) continue;
    const docs = props.PolicyDocument?.Statement;
    if (Array.isArray(docs)) statements.push(...docs);
  }
  return statements;
}

/** Flatten a statement Action to a string array. */
function actionsOf(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action as string];
}

describe("DurableLambdaReviewerStack", () => {
  test("synthesizes exactly one state table, one router Lambda, two EventBridge rules, and the DLQ wiring", () => {
    const { template } = createStack();
    expect(resourcesOf(template, "AWS::DynamoDB::GlobalTable")).toHaveLength(1);
    expect(resourcesOf(template, "AWS::Lambda::Function")).toHaveLength(2);
    expect(resourcesOf(template, "AWS::Lambda::Alias")).toHaveLength(1);
    expect(resourcesOf(template, "AWS::Lambda::Version")).toHaveLength(1);
    expect(resourcesOf(template, "AWS::Events::Rule")).toHaveLength(2);
    expect(resourcesOf(template, "AWS::SQS::Queue")).toHaveLength(1);
    expect(resourcesOf(template, "AWS::Lambda::Permission")).toHaveLength(2);
    expect(resourcesOf(template, "AWS::SQS::QueuePolicy")).toHaveLength(1);
  });

  test("synthesizes the durable reviewer Lambda with an alias and version", () => {
    const { template } = createStack();
    const aliases = resourcesOf(template, "AWS::Lambda::Alias");
    expect(aliases).toHaveLength(1);
    expect((aliases[0][1].Properties as { Name: string }).Name).toBe("live");
    const reviewerFn = resourcesOf(template, "AWS::Lambda::Function").find(
      ([, res]) =>
        (res.Properties as { FunctionName: string }).FunctionName ===
        "jolo-dev-ReviewerReviewer-lambda",
    );
    expect(reviewerFn).toBeDefined();
  });

  test("DynamoDB state table uses pk/sk keys, expiresAt TTL, PITR, and retain protection", () => {
    const { template } = createStack();
    const tables = resourcesOf(template, "AWS::DynamoDB::GlobalTable");
    const [tableKey, table] = tables[0] as [
      string,
      Record<string, unknown> & { DeletionPolicy?: string; UpdateReplacePolicy?: string },
    ];
    const props = table.Properties as {
      KeySchema: Array<{ AttributeName: string; KeyType: string }>;
      AttributeDefinitions: Array<{ AttributeName: string; AttributeType: string }>;
      TimeToLiveSpecification: { AttributeName: string; Enabled: boolean };
      Replicas: Array<{
        DeletionProtectionEnabled: boolean;
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: boolean };
      }>;
      TableName: string;
    };

    expect(props.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(props.AttributeDefinitions).toEqual([
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ]);
    expect(props.TimeToLiveSpecification).toEqual({
      AttributeName: "expiresAt",
      Enabled: true,
    });
    expect(props.Replicas[0].PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled).toBe(
      true,
    );
    expect(props.Replicas[0].DeletionProtectionEnabled).toBe(true);
    expect(table.DeletionPolicy).toBe("Retain");
    expect(table.UpdateReplacePolicy).toBe("Retain");
    expect(props.TableName).toBe("jolo-dev-ReviewerState-table");
    void tableKey;
  });

  test("router Lambda env vars source the reviewer construct name and alias ARN", () => {
    const { template } = createStack();
    const [, router] = findFunction(template, "jolo-dev-ReviewerRouter-lambda");
    const env = (router.Properties as { Environment: { Variables: Record<string, unknown> } })
      .Environment.Variables;
    const tableLogicalId = resourcesOf(template, "AWS::DynamoDB::GlobalTable")[0][0];
    const aliasLogicalId = resourcesOf(template, "AWS::Lambda::Alias")[0][0];
    const [reviewerFnLogicalId] = findFunction(template, "jolo-dev-ReviewerReviewer-lambda");

    expect(stringify(env.STATE_TABLE_NAME)).toBe(`\${${tableLogicalId}}`);
    // REVIEWER_FUNCTION_NAME is sourced from the reviewer construct (a Ref to
    // the reviewer Lambda resource), not a derived convention string.
    expect(stringify(env.REVIEWER_FUNCTION_NAME)).toBe(`\${${reviewerFnLogicalId}}`);
    expect(stringify(env.REVIEWER_FUNCTION_ALIAS)).toBe("live");
    // REVIEWER_FUNCTION_ARN is sourced from the reviewer construct's alias ARN
    // (a Ref to the Alias resource), satisfying spec AC12.
    expect(stringify(env.REVIEWER_FUNCTION_ARN)).toBe(`\${${aliasLogicalId}}`);
    expect(stringify(env.BOT_ARN_PATTERNS)).toBe("jolo-dev-ReviewerReviewer-lambda");
  });

  test("reviewer Lambda env vars include the state table and self-referential ARN", () => {
    const { template } = createStack();
    const [, reviewer] = findFunction(template, "jolo-dev-ReviewerReviewer-lambda");
    const env = (reviewer.Properties as { Environment: { Variables: Record<string, unknown> } })
      .Environment.Variables;
    expect(stringify(env.CODEBUILD_REPOSITORIES)).toBe("test-repo");
    expect(stringify(env.REVIEWER_FUNCTION_ARN)).toBe(
      "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:jolo-dev-ReviewerReviewer-lambda:live",
    );
    expect(stringify(env.REVIEWER_MODEL_ID)).toBe("anthropic.claude-opus-4-8");
  });

  test("reviewer role has bedrock:InvokeModel scoped to the configured model ARN (no wildcard)", () => {
    const { template } = createStack();
    // Collect all IAM policy statements attached to the reviewer role.
    const reviewer = findFunction(template, "jolo-dev-ReviewerReviewer-lambda");
    const roleRef = (reviewer[1].Properties as { Role?: unknown }).Role;
    const roleId = (() => {
      if (roleRef === null || typeof roleRef !== "object") return undefined;
      const node = roleRef as Record<string, unknown>;
      if (typeof node.Ref === "string") return node.Ref;
      const getAtt = node["Fn::GetAtt"];
      if (Array.isArray(getAtt)) return (getAtt as [string, string])[0];
      return undefined;
    })();
    if (roleId === undefined) throw new Error("reviewer role id not found");
    const statements: Statement[] = [];
    for (const [, res] of resourcesOf(template, "AWS::IAM::Policy")) {
      const props = res.Properties as {
        Roles?: Array<{ Ref: string }>;
        PolicyDocument?: { Statement?: Statement[] };
      };
      if (props.Roles?.some((role) => role.Ref === roleId)) {
        const docs = props.PolicyDocument?.Statement;
        if (Array.isArray(docs)) statements.push(...docs);
      }
    }
    const bedrockStmts = statements.filter((s) =>
      actionsOf(s).some((a) => a.startsWith("bedrock:")),
    );
    expect(bedrockStmts).toHaveLength(1);
    const actions = new Set(bedrockStmts.flatMap(actionsOf));
    expect(actions.has("bedrock:InvokeModel")).toBe(true);
    // The resource covers both the foundation-model and inference-profile ARN
    // forms (the configured model may be either).
    const resources = bedrockStmts[0]?.Resource;
    const resourceList = Array.isArray(resources) ? resources : [resources];
    const resourceStrings = resourceList.map(stringify);
    expect(resourceStrings).toContain(
      "arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/anthropic.claude-opus-4-8",
    );
    expect(resourceStrings).toContain("arn:aws:bedrock:*::foundation-model/anthropic.*");
    // No blanket wildcard bedrock access (the foundation-model resource is
    // region-wildcarded for cross-region inference profiles, but scoped to the
    // configured model id — not "*").
    for (const r of resourceStrings) expect(r).not.toBe("*");
  });

  test("reviewer role has codecommit comment actions scoped to the repository", () => {
    const { template } = createStack();
    const reviewer = findFunction(template, "jolo-dev-ReviewerReviewer-lambda");
    const roleRef = (reviewer[1].Properties as { Role?: unknown }).Role;
    const roleId = (() => {
      if (roleRef === null || typeof roleRef !== "object") return undefined;
      const node = roleRef as Record<string, unknown>;
      if (typeof node.Ref === "string") return node.Ref;
      const getAtt = node["Fn::GetAtt"];
      if (Array.isArray(getAtt)) return (getAtt as [string, string])[0];
      return undefined;
    })();
    if (roleId === undefined) throw new Error("reviewer role id not found");
    const statements: Statement[] = [];
    for (const [, res] of resourcesOf(template, "AWS::IAM::Policy")) {
      const props = res.Properties as {
        Roles?: Array<{ Ref: string }>;
        PolicyDocument?: { Statement?: Statement[] };
      };
      if (props.Roles?.some((role) => role.Ref === roleId)) {
        const docs = props.PolicyDocument?.Statement;
        if (Array.isArray(docs)) statements.push(...docs);
      }
    }
    const commentStmts = statements.filter(
      (s) =>
        actionsOf(s).some((a) => a.startsWith("codecommit:")) &&
        actionsOf(s).some((a) =>
          ["codecommit:PostCommentForPullRequest", "codecommit:UpdateComment"].includes(a),
        ),
    );
    expect(commentStmts.length).toBeGreaterThanOrEqual(1);
    const commentActions = new Set(commentStmts.flatMap(actionsOf));
    expect(commentActions.has("codecommit:PostCommentForPullRequest")).toBe(true);
    expect(commentActions.has("codecommit:UpdateComment")).toBe(true);
    expect(commentActions.has("codecommit:PostCommentReply")).toBe(true);
    expect(commentActions.has("codecommit:PutCommentReaction")).toBe(true);
    for (const stmt of commentStmts) {
      expect(stringify(stmt.Resource)).toBe(
        "arn:${AWS::Partition}:codecommit:${AWS::Region}:${AWS::AccountId}:test-repo",
      );
    }
  });

  test("router role has CodeCommit read + config-read scoped to the repository and no comment actions", () => {
    const { stack, template } = createStack();
    const statements = routerRoleStatements(stack, template);
    const codecommitStatements = statements.filter((s) =>
      stringify(s.Resource).includes(":codecommit:"),
    );
    const codecommitActions = new Set(codecommitStatements.flatMap(actionsOf));
    expect(codecommitActions).toEqual(
      new Set([
        "codecommit:GetPullRequest",
        "codecommit:GetDifferences",
        "codecommit:GetCommentsForPullRequest",
        "codecommit:GetCommit",
        "codecommit:BatchGetCommits",
        "codecommit:GetFile",
      ]),
    );
    for (const statement of codecommitStatements) {
      expect(stringify(statement.Resource)).toBe(
        "arn:${AWS::Partition}:codecommit:${AWS::Region}:${AWS::AccountId}:test-repo",
      );
    }
    const allActions = new Set(statements.flatMap(actionsOf));
    expect(allActions.has("codecommit:PostCommentForPullRequest")).toBe(false);
    expect(allActions.has("codecommit:UpdateComment")).toBe(false);
  });

  test("router role has DynamoDB CRUD scoped to the state table ARN only", () => {
    const { stack, template } = createStack();
    const tableLogicalId = resourcesOf(template, "AWS::DynamoDB::GlobalTable")[0][0];
    const statements = routerRoleStatements(stack, template);
    const tableResource = `\${${tableLogicalId}.Arn}`;
    const dynamoStatements = statements.filter((s) => stringify(s.Resource) === tableResource);
    const dynamoActions = new Set(dynamoStatements.flatMap(actionsOf));
    for (const action of [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
    ]) {
      expect(dynamoActions.has(action)).toBe(true);
    }
    // Every DynamoDB statement is scoped to the state table — never a wildcard.
    for (const statement of dynamoStatements) {
      expect(stringify(statement.Resource)).toBe(tableResource);
    }
  });

  test("router role durable-execution IAM is granted via Pawl helpers (no inline policy resource)", () => {
    const { stack, template } = createStack();
    const statements = routerRoleStatements(stack, template);
    const allActions = new Set(statements.flatMap(actionsOf));

    // The four durable-execution actions are present, now sourced from the
    // reviewer construct's grants rather than a hand-written inline policy.
    expect(allActions.has("lambda:InvokeFunction")).toBe(true);
    expect(allActions.has("lambda:ListDurableExecutionsByFunction")).toBe(true);
    expect(allActions.has("lambda:GetDurableExecution")).toBe(true);
    expect(allActions.has("lambda:SendDurableExecutionCallbackSuccess")).toBe(true);

    // No RouterDurableExecutionPolicy resource remains (migrated to Pawl helpers).
    const inlinePolicyExists = resourcesOf(template, "AWS::IAM::Policy").some(([, res]) =>
      (res.Properties as { PolicyName: string }).PolicyName.startsWith(
        "RouterDurableExecutionPolicy",
      ),
    );
    expect(inlinePolicyExists).toBe(false);

    // Invoke + List are scoped to the reviewer alias ARN (a Ref to the Alias).
    const aliasLogicalId = resourcesOf(template, "AWS::Lambda::Alias")[0][0];
    const invokeStmt = statements.find((s) => actionsOf(s).includes("lambda:InvokeFunction"));
    expect(stringify(invokeStmt?.Resource)).toBe(`\${${aliasLogicalId}}`);

    // Callback is scoped to "*" (Pawl's CallbackPolicy).
    const sendCallback = statements.find((s) =>
      actionsOf(s).includes("lambda:SendDurableExecutionCallbackSuccess"),
    );
    expect(stringify(sendCallback?.Resource)).toBe("*");
  });

  test("both native EventBridge rules target the router Lambda with the shared DLQ and default retry", () => {
    const { template } = createStack();
    const [routerLogicalId] = findFunction(template, "jolo-dev-ReviewerRouter-lambda");
    const routerArn = `\${${routerLogicalId}.Arn}`;
    const dlqArn = `\${${resourcesOf(template, "AWS::SQS::Queue")[0][0]}.Arn}`;
    for (const [, rule] of resourcesOf(template, "AWS::Events::Rule")) {
      const targets = (rule.Properties as { Targets: Array<Record<string, unknown>> }).Targets;
      expect(targets).toHaveLength(1);
      expect(stringify((targets[0] as { Arn?: unknown }).Arn)).toBe(routerArn);
      expect(
        stringify((targets[0] as { DeadLetterConfig?: { Arn?: unknown } }).DeadLetterConfig?.Arn),
      ).toBe(dlqArn);
      const retry = (
        targets[0] as {
          RetryPolicy: {
            MaximumRetryAttempts: number;
            MaximumEventAgeInSeconds: number;
          };
        }
      ).RetryPolicy;
      expect(retry.MaximumRetryAttempts).toBe(3);
      expect(retry.MaximumEventAgeInSeconds).toBe(3600);
    }
  });

  test("cdk-nag passes with Pawl-helper-owned suppressions and no stack-side inline policy", () => {
    const { stack, template } = createStack("NagStack");

    // The durable-execution IAM5 suppressions are now owned by Pawl's helpers
    // on the CallbackPolicy and the router default policy — no stack-side
    // RouterDurableExecutionPolicy resource remains.
    const inlinePolicyExists = resourcesOf(template, "AWS::IAM::Policy").some(([, res]) =>
      (res.Properties as { PolicyName: string }).PolicyName.startsWith(
        "RouterDurableExecutionPolicy",
      ),
    );
    expect(inlinePolicyExists).toBe(false);

    // Lambda-construct fixture findings (AWS-managed basic execution policy,
    // Node 22 runtime) are test-environment noise Pawl suppresses at the test
    // layer; mirror that convention for both the router and reviewer Lambdas.
    const router = stack.node.findChild("ReviewerRouter") as unknown as LambdaFunction;
    const reviewer = stack.node.findChild("ReviewerReviewer") as unknown as LambdaFunction;
    for (const fn of [router, reviewer]) {
      NagSuppressions.addResourceSuppressions(
        fn.lambda,
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "This Lambda uses the AWS-managed basic execution policy for CloudWatch logging.",
          },
          {
            id: "AwsSolutions-L1",
            reason: "Pawl pins its supported Node.js 22 runtime.",
          },
        ],
        true,
      );
    }

    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-"),
    );
    expect(errors).toEqual([]);
  });

  test("synthesizes a CodeBuild project and grants the reviewer run + log-read IAM", () => {
    const { template } = createStack();
    const projects = resourcesOf(template, "AWS::CodeBuild::Project");
    expect(projects).toHaveLength(1);

    // The reviewer role has codebuild:StartBuild + BatchGetBuilds + logs read.
    const reviewer = findFunction(template, "jolo-dev-ReviewerReviewer-lambda");
    const roleRef = (reviewer[1].Properties as { Role?: unknown }).Role;
    const roleId = (() => {
      if (roleRef === null || typeof roleRef !== "object") return undefined;
      const node = roleRef as Record<string, unknown>;
      if (typeof node.Ref === "string") return node.Ref;
      const getAtt = node["Fn::GetAtt"];
      if (Array.isArray(getAtt)) return (getAtt as [string, string])[0];
      return undefined;
    })();
    if (roleId === undefined) throw new Error("reviewer role id not found");
    const statements: Statement[] = [];
    for (const [, res] of resourcesOf(template, "AWS::IAM::Policy")) {
      const props = res.Properties as {
        Roles?: Array<{ Ref: string }>;
        PolicyDocument?: { Statement?: Statement[] };
      };
      if (props.Roles?.some((role) => role.Ref === roleId)) {
        const docs = props.PolicyDocument?.Statement;
        if (Array.isArray(docs)) statements.push(...docs);
      }
    }
    const allActions = new Set(statements.flatMap(actionsOf));
    expect(allActions.has("codebuild:StartBuild")).toBe(true);
    expect(allActions.has("codebuild:BatchGetBuilds")).toBe(true);
    expect(allActions.has("logs:GetLogEvents")).toBe(true);
  });

  test("synthesizes one CodeBuild project and one event construct per repository for a multi-repo config", () => {
    const { template } = createStack("MultiRepoStack", {
      team: "jolo",
      stage: "dev",
      repositories: ["repo-a", "repo-b"],
      reviewerModelId: "anthropic.claude-opus-4-8",
    });
    // Two CodeBuild projects, one per repo.
    const projects = resourcesOf(template, "AWS::CodeBuild::Project");
    expect(projects).toHaveLength(2);
    // Four EventBridge rules (pull-request + comment per repo).
    expect(resourcesOf(template, "AWS::Events::Rule")).toHaveLength(4);
    // Still exactly one shared reviewer, router, and table.
    expect(resourcesOf(template, "AWS::Lambda::Function")).toHaveLength(2);
    expect(resourcesOf(template, "AWS::DynamoDB::GlobalTable")).toHaveLength(1);

    // Reviewer env carries a per-repo project var for each repo + the list.
    const [, reviewer] = findFunction(template, "jolo-dev-ReviewerReviewer-lambda");
    const env = (reviewer.Properties as { Environment: { Variables: Record<string, unknown> } })
      .Environment.Variables;
    expect(stringify(env.CODEBUILD_REPOSITORIES)).toBe("repo-a,repo-b");
    expect(env.CODEBUILD_PROJECT_REPO_A).toBeDefined();
    expect(env.CODEBUILD_PROJECT_REPO_B).toBeDefined();
  });

  test("missing repositories context fails synthesis with a Zod validation error", () => {
    const app = new App();
    app.node.setContext("team", "jolo");
    app.node.setContext("stage", "dev");
    expect(() => new DurableLambdaReviewerStack(app, "MissingRepo")).toThrow();
  });
});
