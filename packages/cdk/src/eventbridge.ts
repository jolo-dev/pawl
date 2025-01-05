import type { SecretValue } from "aws-cdk-lib";
import {
  EventBus,
  type EventBusProps,
  type EventPattern,
  type IRuleTarget,
  Rule,
} from "aws-cdk-lib/aws-events";
import * as eventtarget from "aws-cdk-lib/aws-events-targets";
import { Queue, RedrivePermission } from "aws-cdk-lib/aws-sqs";

import { ApiDestination } from "./api-destination";
import { BasicConstruct } from "./basic-construct";
import { LambdaFunction } from "./lambda-function";
import { Sqs } from "./sqs";
import { Stack } from "./stack";

/**
 * @interface
 */
export type EventTarget = {
  type: LambdaFunction | ApiDestination | Sqs | EventBridge;
  eventPattern: EventPattern;
};

export interface EventBridgeProps extends Omit<EventBusProps, "deadLetterQueue"> {
  eventBusName: string;
  targets: EventTarget[];
  secrets?: EventTarget extends ApiDestination ? SecretValue : undefined;
}

/**
 * The Eventbridge Construct consists of an Eventbus that can have **multiple** rule with different targets (see below).
 * Every failed message will be put into a DLQ.
 * 
 * > Note: It can have multiple rules of different Types. For example, 2 Lambda rules, 1 SQS and many API destination for one Eventbus.
 * 
 * ```mermaid
  architecture-beta
    group rules(hugeicons:paragraph-bullets-point-01)[Rules]
    service eventbridge(logos:aws-eventbridge)[AWS Eventbridge]
    service lambda(logos:aws-lambda)[AWS Lambda] in rules
    service sqs(logos:aws-sqs)[AWS SQS] in rules
    service api(hugeicons:api)[Api Destination] in rules
    service eventbridgerule(logos:aws-eventbridge)[AWS EventBus] in rules
    service dlq(logos:aws-sqs)[DLQ]
    api{group}:R --> L:eventbridge
    eventbridge:B --> T:dlq
 * ```
 * @example
 * ```ts
 * const eventPattern = { source: ["foo"] };
 * declare lambda: LambdaFunction
 * new EventBridge(this, "test", {
    eventBusName: "TestEventBus",
    targets: [{
      type: lambda,
      eventPattern,
    },
    {
      type: new ApiDestination(this, "ApiDestination", {
        apiDestinationName: "foo",
        authorization: Authorization.basic("foo", SecretValue.unsafePlainText("test-unsafe")),
        description: "This goes to an API",
        endpoint: "https://foo.bar",
      }),
      eventPattern
    }],
  });
    ```
 */
export class EventBridge extends BasicConstruct {
  public eventBus: EventBus;
  /**
   * The function creates an EventBridge with specified targets and sets up corresponding rules for
   * each target.
   * @param {Stack} scope - The `scope` parameter in the constructor refers to the AWS CloudFormation
   * stack where the EventBridge resources will be created. It provides a way to define the scope or
   * context for the resources being created within the stack.
   * @param {string} id - The `id` parameter in the constructor function represents the unique
   * identifier for the EventBridge stack being created. It is used to distinguish this stack from
   * others and is typically provided by the user when instantiating the stack.
   * @param {EventBridgeProps} props - The `props` parameter in the constructor function seems to be of
   * type `EventBridgeProps`. It likely contains information and configurations related to setting up
   * EventBridge rules and targets. Based on the code snippet provided, it seems to include details
   * such as the event bus name, targets for the rules, and
   */
  constructor(scope: Stack, id: string, props: EventBridgeProps) {
    super(scope, id);

    const dlq = new Queue(this, "DLQ", {
      queueName: `${props.eventBusName}-dlq`,
      redriveAllowPolicy: {
        redrivePermission: RedrivePermission.ALLOW_ALL,
      },
    });

    this.eventBus = new EventBus(this, "EventBus", {
      deadLetterQueue: dlq,
      eventBusName: props.eventBusName,
    });

    // rules can have up to 5 targets
    // Q: should each target have their own rule?
    //    But that is why EventBridge became so powerful because of many targets
    // For now each rule gets one target
    for (const target of props.targets) {
      if (target.type instanceof LambdaFunction) {
        this.createRule(
          "LambdaRule",
          new eventtarget.LambdaFunction(target.type.lambda, { deadLetterQueue: dlq }),
          target.eventPattern,
        );
      } else if (target.type instanceof ApiDestination && props.secrets) {
        this.createRule(
          "ApiDestinationRule",
          new eventtarget.ApiDestination(target.type),
          target.eventPattern,
        );
      } else if (target.type instanceof Sqs) {
        this.createRule(
          "SqsRule",
          new eventtarget.SqsQueue(target.type.queue, {
            messageGroupId: `${Stack.of(this).stackName}-sqs`,
          }),
          target.eventPattern,
        );
      } else if (target.type instanceof EventBridge) {
        this.createRule(
          "EventBridgeRule",
          new eventtarget.EventBus(target.type.eventBus),
          target.eventPattern,
        );
      }
    }

    this.setOutput({
      value: this.eventBus.eventBusArn,
      description: `Eventbus ${id} ARN`,
    });
    this.setOutput({
      value: this.eventBus.eventBusName,
      description: `Eventbus ${id} Name`,
    });

    this.createAlarm(this.stack);
  }

  /**
   * The function `createRule` creates a new Rule object with the specified ruleId, target, and
   * eventPattern.
   * @param {string} ruleId - The `ruleId` parameter is a string that represents the unique identifier
   * for the rule being created. It is used to identify and reference the rule within the system.
   * @param {IRuleTarget} target - The `target` parameter in the `createRule` function represents the
   * target where the rule will be applied. It should be an object that implements the `IRuleTarget`
   * interface. This interface likely contains properties or methods that define how the rule should be
   * triggered or executed.
   * @param {EventPattern} eventPattern - The `eventPattern` parameter in the `createRule` function is
   * used to specify the event pattern that the rule should match. This event pattern defines the
   * criteria for events that will trigger the rule. It can include conditions based on event
   * attributes such as source, detail type, and other fields to filter
   * @returns A Rule object is being returned.
   */
  createRule(ruleId: string, target: IRuleTarget, eventPattern: EventPattern): Rule {
    return new Rule(this, ruleId, {
      eventBus: this.eventBus,
      eventPattern: eventPattern,
      targets: [target],
    });
  }

  /**
   * The function createAlarm creates an alarm factory for monitoring a stack using the node ID and
   * eventbridge.
   * @param {Stack} stack - The `stack` parameter is a Stack object that is being passed to the
   * `createAlarm` function.
   */
  createAlarm(stack: Stack): void {
    stack.monitoring.createAlarmFactory(`${this.node.id}-eventbridge`);
  }
}
