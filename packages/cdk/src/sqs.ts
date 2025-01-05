import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { Duration } from "aws-cdk-lib/core";
import { BasicConstruct } from "./basic-construct";
import type { BasicTagsProps } from "./basic-tags";
import type { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

interface SqsProps
  extends Omit<QueueProps, "queueName" | "contentBasedDeduplication" | "deadLetterQueue"> {
  fn: LambdaFunction;
  fifo: boolean;
  retry: number;
}

/**
 * ```mermaid
 * architecture-beta
 *  service sqs(logos:aws-sqs)[AWS SQS]
 *  service dlq(logos:aws-dlq)[AWS DLQ]
 * ```
 */
export class Sqs extends BasicConstruct {
  public queue;
  /**
   * The constructor function creates an SQS queue with a dead-letter queue (DLQ) and sets up event
   * source mapping for a Lambda function to consume messages from the queue.
   * @param {Stack} scope - The `scope` parameter in the constructor refers to the stack where the
   * resources will be created. It is typically an instance of the `Stack` class in an AWS
   * CloudFormation template. The stack provides a scope for creating AWS resources within a specific
   * context, allowing you to manage and deploy related resources together
   * @param {string} id - The `id` parameter in the constructor function represents the identifier or
   * name for the resources being created within the stack. It is used to uniquely identify and name
   * the SNS topic, SQS queues, and other resources created within the constructor.
   * @param {SqsProps} props - The `props` parameter in the constructor function contains the
   * configuration properties for setting up the SQS (Simple Queue Service) and SNS (Simple
   * Notification Service) resources. These properties include:
   */
  constructor(scope: Stack, id: string, props: SqsProps) {
    super(scope, id);
    // Create the SNS topic
    const topic = new Topic(this, "Sns", {
      displayName: `${id} DLQ Topic`,
      topicName: `${id}-sns-topic`,
      fifo: props.fifo,
      contentBasedDeduplication: true,
    });

    // Create the SQS DLQ
    const dlq = new Queue(this, "DLQ", {
      queueName: `${id}-dlq${props.fifo ? ".fifo" : ""}`,
      retentionPeriod: Duration.days(1),
      fifo: props.fifo,
    });

    // Subscribe the SNS topic to the DLQ
    topic.addSubscription(new SqsSubscription(dlq));

    // Create the main SQS queue with DLQ
    this.queue = new Queue(this, "SQS", {
      ...props,
      queueName: `${id}-sqs${props.fifo ? ".fifo" : ""}`,
      fifo: props.fifo,
      contentBasedDeduplication: props.fifo,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: props.retry, // Retry count
      },
    });

    // Grant the Lambda function permissions to read from the SQS queue
    this.queue.grantConsumeMessages(props.fn.lambda);

    // Set up the event source mapping for the Lambda function
    props.fn.lambda.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 10,
      }),
    );
  }
  /**
   * The `createAlarm` function sets up monitoring for an SQS queue in a given stack.
   * @param {Stack} stack - The `stack` parameter is a Stack object that is being passed to the
   * `createAlarm` function.
   */
  createAlarm(stack: Stack): void {
    stack.monitoring.monitorSqsQueue({
      queue: this.queue,
    });
  }
}
