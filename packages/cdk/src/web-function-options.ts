/** Authentication mode for a Lambda Web Function endpoint. */
export class WebFunctionAuthType {
	public static readonly IAM_AUTH = new WebFunctionAuthType("IamAuth");
	public static readonly APPLICATION_MANAGED = new WebFunctionAuthType(
		"ApplicationManaged",
	);

	private constructor(public readonly value: string) {}
}

/** Region behavior for a Lambda Web Function endpoint. */
export class WebFunctionEndpointType {
	public static readonly HOME_REGION = new WebFunctionEndpointType(
		"HomeRegion",
	);
	public static readonly MULTI_REGION = new WebFunctionEndpointType(
		"MultiRegion",
	);
	public static readonly PER_REGION = new WebFunctionEndpointType("PerRegion");

	private constructor(public readonly value: string) {}
}
