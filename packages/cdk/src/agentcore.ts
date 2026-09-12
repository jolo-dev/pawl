import { Duration } from "aws-cdk-lib";
import {
	AgentCoreRuntime,
	AgentRuntimeArtifact,
	ProtocolType,
	Runtime,
	RuntimeEndpoint,
	RuntimeNetworkConfiguration,
	type RuntimeProps,
} from "aws-cdk-lib/aws-bedrockagentcore";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
	type IRole,
} from "aws-cdk-lib/aws-iam";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { Construct, Stack } from "./stack";
import { resolveScope } from "./stack-function";

export type AgentCoreProps = {
	/** Directory containing the built Node.js AgentCore application. */
	assetPath?: string;
	endpoint?: {
		name?: string;
		description?: string;
	};
} & Omit<RuntimeProps, "agentRuntimeArtifact" | "protocolConfiguration"> &
	BasicConstructProps;

/**
 * Creates a Node.js 22 code-asset HTTP runtime and a runtime endpoint, always
 * including the DEFAULT endpoint when endpoint options are absent. The code asset
 * is packaging, not another runtime service. Execution-role options pass through
 * to the runtime; explicit grants add execution permissions. No Bedrock model or
 * VPC is provisioned. Monitoring uses the existing stack facility, not an owned
 * monitoring service. Undirected edges show endpoint configuration.
 *
 * ```mermaid
 * architecture-beta
 *   group agent(cloud)[AgentCore runtime]
 *   service asset(disk)[Code asset] in agent
 *   service runtime(logos:nodejs-icon)[HTTP runtime Node 22] in agent
 *   service endpoint(cloud)[Runtime endpoint] in agent
 *   asset:R --> L:runtime
 *   runtime:R -- L:endpoint
 * ```
 */
export class AgentCore extends BasicConstruct {
	readonly runtime: Runtime;
	readonly endpoint: RuntimeEndpoint;
	readonly role: IRole;
	readonly runtimeArn: string;
	readonly runtimeId: string;
	readonly endpointArn: string;
	readonly assetPath: string;

	constructor(scope: Stack, id: string, props?: AgentCoreProps);
	constructor(id: string, props?: AgentCoreProps);
	constructor(
		scopeOrId: Stack | string,
		idOrProps?: string | AgentCoreProps,
		maybeProps?: AgentCoreProps,
	) {
		const scope = typeof scopeOrId === "string" ? resolveScope() : scopeOrId;
		const id = typeof scopeOrId === "string" ? scopeOrId : idOrProps;
		if (typeof id !== "string") {
			throw new Error("Invalid AgentCore constructor arguments");
		}

		const props =
			typeof scopeOrId === "string"
				? (idOrProps as AgentCoreProps)
				: maybeProps;
		const resolvedProps = props ?? {};
		const {
			assetPath = ".pawl/agentcore",
			endpoint,
			permissions,
			...runtimeProps
		} = resolvedProps;

		super(scope, id);
		this.assetPath = assetPath;

		this.runtime = new Runtime(this, "Runtime", {
			...runtimeProps,
			agentRuntimeArtifact: AgentRuntimeArtifact.fromCodeAsset({
				entrypoint: ["index.js"],
				path: assetPath,
				runtime: AgentCoreRuntime.NODE_22,
			}),
			networkConfiguration:
				runtimeProps.networkConfiguration ??
				RuntimeNetworkConfiguration.usingPublicNetwork(),
			protocolConfiguration: ProtocolType.HTTP,
			runtimeName: runtimeProps.runtimeName ?? this.createRuntimeName(id),
		});
		this.role = this.runtime.role;

		this.endpoint = new RuntimeEndpoint(this, "Endpoint", {
			agentRuntimeId: this.runtime.agentRuntimeId,
			agentRuntimeVersion: this.runtime.agentRuntimeVersion,
			description: endpoint?.description,
			endpointName: endpoint?.name ?? "DEFAULT",
		});

		this.runtimeArn = this.runtime.agentRuntimeArn;
		this.runtimeId = this.runtime.agentRuntimeId;
		this.endpointArn = this.endpoint.agentRuntimeEndpointArn;

		if (permissions) this.grantPermissions(permissions);
		this.createAlarm(this.stack);
	}

	protected applyPermissionPolicy(
		_construct: Construct,
		policyStatement: PolicyStatement,
	): void {
		this.runtime.addToRolePolicy(
			new IamPolicyStatement({
				actions: policyStatement.actions,
				effect: policyStatement.effect === "allow" ? Effect.ALLOW : Effect.DENY,
				resources: [policyStatement.resource ?? this.runtimeArn],
			}),
		);
	}

	createAlarm(stack: Stack): void {
		stack.monitoring.monitorCustom({
			alarmFriendlyName: `${this.node.id}-AgentCore-Runtime`,
			humanReadableName: `${this.node.id} AgentCore Runtime`,
			metricGroups: [
				{
					metrics: [
						this.runtime.metricInvocations({ period: Duration.minutes(5) }),
						this.runtime.metricLatency({ period: Duration.minutes(5) }),
						this.runtime.metricTotalErrors({ period: Duration.minutes(5) }),
						this.runtime.metricThrottles({ period: Duration.minutes(5) }),
					],
					title: `${this.node.id} AgentCore Runtime`,
				},
			],
		});
	}

	private createRuntimeName(id: string): string {
		const name = `${this.prefix}${id}-agentcore`.replaceAll(
			/[^a-zA-Z0-9_]/g,
			"_",
		);
		return /^[a-zA-Z]/.test(name) ? name.slice(0, 48) : `A${name}`.slice(0, 48);
	}
}
