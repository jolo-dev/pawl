import {
	Effect,
	PolicyStatement as IamPolicyStatement,
} from "aws-cdk-lib/aws-iam";
import { Topic, type TopicProps } from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { Stack } from "./stack";

/**
 * Properties for the SnsTopic construct
 */
export interface SnsTopicProps extends BasicConstructProps {
	/**
	 * The display name of the topic
	 */
	displayName: string;

	/**
	 * Whether to set up default alarms for this topic
	 * @default true
	 */
	createDefaultAlarms?: boolean;

	/**
	 * Additional SNS topic properties
	 */
	topicProps?: Omit<TopicProps, "displayName">;
}

/**
 * A construct representing an SNS Topic with added capabilities from BasicConstruct
 */
export class SnsTopic extends BasicConstruct {
	/**
	 * The underlying SNS Topic
	 */
	public readonly topic: Topic;

	constructor(scope: Stack, id: string, props: SnsTopicProps) {
		// Pass the entire props object to the parent constructor
		super(scope, id, props);

		// Create the underlying SNS Topic
		this.topic = new Topic(this, "Resource", {
			displayName: props.displayName,
			...props.topicProps,
		});

		// Set output with the topic ARN
		this.setOutput({
			description: `${id} SNS Topic ARN`,
			value: this.topic.topicArn,
		});

		// Create default alarms if not explicitly disabled
		if (props.createDefaultAlarms !== false) {
			this.createAlarm(scope);
		}
	}

	/**
	 * Implementation of the abstract method to apply permission policies to this resource
	 * @param construct The construct that will be granted permissions to this topic
	 * @param policyStatement The permission policy to apply
	 */
	protected applyPermissionPolicy(
		construct: Construct,
		policyStatement: PolicyStatement,
	): void {
		// Translate our generic PolicyStatement to AWS IAM PolicyStatement
		const iamPolicyStatement = new IamPolicyStatement({
			effect: policyStatement.effect === "allow" ? Effect.ALLOW : Effect.DENY,
			actions: policyStatement.actions,
			resources: [policyStatement.resource || this.topic.topicArn],
		});

		// Add the policy to the topic's resource policy
		this.topic.addToResourcePolicy(iamPolicyStatement);

		// Log the permission grant for debugging
		console.log(
			`Granted ${policyStatement.effect} for ${policyStatement.actions.join(", ")} to ${construct.node.id}`,
		);
	}

	/**
	 * Implementation of the abstract method to create alarms for this resource
	 * @param stack The stack scope
	 */
	createAlarm(stack: Stack): void {
		stack.monitoring.monitorSnsTopic({
			topic: this.topic,
		});
	}

	/**
	 * Grant permission to publish to this topic
	 * @param construct The construct to grant publish permission to
	 * @returns The SnsTopic instance for method chaining
	 */
	public grantPublish(construct: Construct): SnsTopic {
		this.grantPermission(construct, {
			effect: "allow",
			actions: ["sns:Publish"],
		});
		return this;
	}

	/**
	 * Grant permission to subscribe to this topic
	 * @param construct The construct to grant subscribe permission to
	 * @returns The SnsTopic instance for method chaining
	 */
	public grantSubscribe(construct: Construct): SnsTopic {
		this.grantPermission(construct, {
			effect: "allow",
			actions: ["sns:Subscribe", "sns:ConfirmSubscription"],
		});
		return this;
	}
}
