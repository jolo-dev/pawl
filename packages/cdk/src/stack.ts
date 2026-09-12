import { Stack as CdkStack, type StackProps } from "aws-cdk-lib";
import { MonitoringFacade } from "cdk-monitoring-constructs";
import type { Construct } from "constructs";

const noopMonitoring = new Proxy(
	{},
	{ get: () => () => noopMonitoring },
) as MonitoringFacade;

/**
 * Extends the CDK stack with shared monitoring for Pawl constructs. The stack
 * node is an assembly root, not an extra deployed service. Outside LOCAL it
 * supplies a MonitoringFacade; when LOCAL is truthy it uses a shared recursive
 * no-op proxy instead. These are alternative implementation modes, not three
 * mandatory deployed resources. The class does not instantiate application
 * constructs or guarantee any particular alarms. Undirected edges show configuration.
 *
 * ```mermaid
 * architecture-beta
 *   group stackGroup(logos:aws-cloudformation)[Assembly root]
 *   group cloudMode(logos:aws-cloudwatch)[Outside LOCAL]
 *   group localMode(server)[LOCAL truthy]
 *   service stack(logos:aws-cloudformation)[CDK stack] in stackGroup
 *   service monitoring(logos:aws-cloudwatch)[MonitoringFacade] in cloudMode
 *   service noop(server)[No op monitoring] in localMode
 *   stack:R -- L:monitoring
 *   stack:L -- R:noop
 * ```
 */
export class Stack extends CdkStack {
	public monitoring: MonitoringFacade;
	constructor(scope?: Construct, id?: string, props?: StackProps) {
		super(scope, id, props);
		this.monitoring = process.env.LOCAL
			? noopMonitoring
			: new MonitoringFacade(this, `${id}-CloudwatchDashboard`, {
					alarmFactoryDefaults: {
						actionsEnabled: true,
						alarmNamePrefix: id ?? "alarm",
					},
				});
	}
}

export { Construct } from "constructs";
