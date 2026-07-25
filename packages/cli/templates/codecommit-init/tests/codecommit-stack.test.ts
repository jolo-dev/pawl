import { describe, expect, test } from "bun:test";
import { Template } from "aws-cdk-lib/assertions";
import { App } from "@pawl/cdk";
import { CodeCommitStack } from "../stacks/codecommit-stack";

describe("CodeCommitStack", () => {
  test("synthesizes a retained CodeCommit repository", () => {
    const app = new App();
    const stack = new CodeCommitStack(app, "TestStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CodeCommit::Repository", {
      RepositoryName: "{{repositoryName}}",
    });
    template.hasResource("AWS::CodeCommit::Repository", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });
});