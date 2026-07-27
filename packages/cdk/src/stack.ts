import { Stack as CdkStack, type StackProps } from "aws-cdk-lib";
import { MonitoringFacade } from "cdk-monitoring-constructs";
import type { Construct } from "constructs";

const noopMonitoring = new Proxy(
  {},
  { get: () => () => noopMonitoring },
) as MonitoringFacade;

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
