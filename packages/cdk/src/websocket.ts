import { EventApi } from "aws-cdk-lib/aws-appsync";
import type { Construct } from "constructs";
import { BasicConstruct, type PolicyStatement } from "./basic-construct";
import type { Stack } from "./stack";

export class Websocket extends BasicConstruct {
	constructor(scope: Stack, id: string) {
		super(scope, id);

		new EventApi(this, "WebSocketAPI", {
			apiName: `${this.prefix}${id}-appsync-event-api`,
		});
	}
	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: PolicyStatement,
	): void {
		throw new Error("Method not implemented.");
	}
	createAlarm(_scope: Stack): void {
		throw new Error("Method not implemented.");
	}
}
