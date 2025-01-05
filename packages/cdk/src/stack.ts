import { Stack as CdkStack, type StackProps } from "aws-cdk-lib";
import { MonitoringFacade } from "cdk-monitoring-constructs";
import type { Construct } from "constructs";

export class Stack extends CdkStack {
  public monitoring;
  constructor(scope?: Construct, id?: string, props?: StackProps) {
    super(scope, id, props);
    this.monitoring = new MonitoringFacade(this, "CloudwatchDashboard", {
      // Defaults are provided for these, but they can be customized as desired
      alarmFactoryDefaults: {
        actionsEnabled: true,
        alarmNamePrefix: id ?? "alarm",
      },
    });
  }
}

export { Construct } from "constructs";
