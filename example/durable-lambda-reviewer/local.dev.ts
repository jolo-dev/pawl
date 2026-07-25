import { defineStacks } from "@pawl/cdk";
import { DurableLambdaReviewerStack } from "./stacks/reviewer-stack";
import { CodePipelineReviewerStack } from "./stacks/pipeline-stack";

defineStacks(DurableLambdaReviewerStack, CodePipelineReviewerStack);
