import { defineStacks } from "@pawl/cdk";
import { CodePipelineReviewerStack } from "./stacks/pipeline-stack";
import { DurableLambdaReviewerStack } from "./stacks/reviewer-stack";

defineStacks(DurableLambdaReviewerStack, CodePipelineReviewerStack);
