import { defineStacks } from "@pawl/cdk";
import { EventBridgeStack } from "./stacks/eventbridge-stack";
import { SimpleApiStack } from "./stacks/simple-api-stack";

defineStacks(SimpleApiStack, EventBridgeStack);
