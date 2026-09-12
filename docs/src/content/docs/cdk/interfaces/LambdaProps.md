---
editUrl: false
next: false
prev: false
title: "LambdaProps"
---

Defined in: [packages/cdk/src/lambda-function.ts:24](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/lambda-function.ts#L24)

## Properties

### adotInstrumentation?

> `readonly` `optional` **adotInstrumentation?**: `AdotInstrumentationConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:353

Specify the configuration of AWS Distro for OpenTelemetry (ADOT) instrumentation

#### See

https://aws-otel.github.io/docs/getting-started/lambda

#### Default

```ts
- No ADOT instrumentation
```

***

### allowAllIpv6Outbound?

> `readonly` `optional` **allowAllIpv6Outbound?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:286

Whether to allow the Lambda to send all ipv6 network traffic

If set to true, there will only be a single egress rule which allows all
outbound ipv6 traffic. If set to false, you must individually add traffic rules to allow the
Lambda to connect to network targets using ipv6.

Do not specify this property if the `securityGroups` or `securityGroup` property is set.
Instead, configure `allowAllIpv6Outbound` directly on the security group.

#### Default

```ts
false
```

***

### allowAllOutbound?

> `readonly` `optional` **allowAllOutbound?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:273

Whether to allow the Lambda to send all network traffic (except ipv6)

If set to false, you must individually add traffic rules to allow the
Lambda to connect to network targets.

Do not specify this property if the `securityGroups` or `securityGroup` property is set.
Instead, configure `allowAllOutbound` directly on the security group.

#### Default

```ts
true
```

***

### allowPublicSubnet?

> `readonly` `optional` **allowPublicSubnet?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:459

Lambda Functions in a public subnet can NOT access the internet.
Use this property to acknowledge this limitation and still place the function in a public subnet.

#### See

https://stackoverflow.com/questions/52992085/why-cant-an-aws-lambda-function-inside-a-public-subnet-in-a-vpc-connect-to-the/52994841#52994841

#### Default

```ts
false
```

***

### ~~applicationLogLevel?~~

> `readonly` `optional` **applicationLogLevel?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:534

Sets the application log level for the function.

:::caution[Deprecated]
Use `applicationLogLevelV2` as a property instead.
:::

#### Default

```ts
"INFO"
```

***

### applicationLogLevelV2?

> `readonly` `optional` **applicationLogLevelV2?**: `ApplicationLogLevel`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:539

Sets the application log level for the function.

#### Default

```ts
ApplicationLogLevel.INFO
```

***

### authorizer?

> `optional` **authorizer?**: `boolean`

Defined in: [packages/cdk/src/lambda-function.ts:26](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/lambda-function.ts#L26)

***

### awsSdkConnectionReuse?

> `readonly` `optional` **awsSdkConnectionReuse?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:78

The `AWS_NODEJS_CONNECTION_REUSE_ENABLED` environment variable does not exist in the AWS SDK for JavaScript v3.

This prop will be deprecated when the Lambda Node16 runtime is deprecated on June 12, 2024.
See https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html#runtime-support-policy

Info for Node 16 runtimes / SDK v2 users:

Whether to automatically reuse TCP connections when working with the AWS
SDK for JavaScript v2.

This sets the `AWS_NODEJS_CONNECTION_REUSE_ENABLED` environment variable
to `1`.

#### See

https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-reusing-connections.html

#### Default

```ts
- false (obsolete) for runtimes >= Node 18, true for runtimes <= Node 16.
```

***

### bundling?

> `readonly` `optional` **bundling?**: `BundlingOptions`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:98

Bundling options

#### Default

```ts
- use default bundling options: no minify, no sourcemap, all
  modules are bundled.
```

***

### codeSigningConfig?

> `readonly` `optional` **codeSigningConfig?**: `ICodeSigningConfigRef`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:471

Code signing config associated with this function

#### Default

```ts
- Not Sign the Code
```

***

### currentVersionOptions?

> `readonly` `optional` **currentVersionOptions?**: `VersionOptions`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:445

Options for the `lambda.Version` resource automatically created by the
`fn.currentVersion` method.

#### Default

- default options as described in `VersionOptions`

***

### deadLetterQueue?

> `readonly` `optional` **deadLetterQueue?**: `IQueue`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:300

The SQS queue to use if DLQ is enabled.
If SNS topic is desired, specify `deadLetterTopic` property instead.

#### Default

- SQS queue with 14 day retention period if `deadLetterQueueEnabled` is `true`

***

### deadLetterQueueEnabled?

> `readonly` `optional` **deadLetterQueueEnabled?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:293

Enabled DLQ. If `deadLetterQueue` is undefined,
an SQS queue with default options will be defined for your Function.

#### Default

- false unless `deadLetterQueue` is set, which implies DLQ is enabled.

***

### deadLetterTopic?

> `readonly` `optional` **deadLetterTopic?**: `ITopic`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:308

The SNS topic to use as a DLQ.
Note that if `deadLetterQueueEnabled` is set to `true`, an SQS queue will be created
rather than an SNS topic. Using an SNS topic as a DLQ requires this property to be set explicitly.

#### Default

```ts
- no SNS topic
```

***

### depsLockFilePath?

> `readonly` `optional` **depsLockFilePath?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:91

The path to the dependencies lock file (`yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `bun.lock` or `package-lock.json`).

This will be used as the source for the volume mounted in the Docker
container.

Modules specified in `nodeModules` will be installed using the right
installer (`yarn`, `pnpm`, `bun` or `npm`) along with this lock file.

#### Default

- the path is found by walking up parent directories searching for
  a `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `bun.lock` or `package-lock.json` file

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:156

A description of the function.

#### Default

```ts
- No description.
```

***

### durableConfig?

> `readonly` `optional` **durableConfig?**: `DurableConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:496

The durable configuration for the function.

If durability is added to an existing function, a resource replacement will be triggered.
See the 'durableConfig' section in the module README for more details.

#### Default

```ts
- No durable configuration
```

***

### entry

> **entry**: `string`

Defined in: [packages/cdk/src/lambda-function.ts:25](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/lambda-function.ts#L25)

Path to the entry file (JavaScript or TypeScript).

If this is a relative path, it will be evaluated with respect to the
JavaScript/TypeScript source file that instantiates the `NodejsFunction`
construct. If the current project is not a Node project, relative paths are
not reliable and absolute paths should be used.

This file should be located underneath the `projectRoot` directory (by default,
the directory containing the package manager's lock file).

If omitted, the entry file will be derived from the TypeScript/JavaScript file
that instantiates the `NodejsFunction` construct, and the construct identifier
of the `NodejsFunction` construct, in the following way:

```
<filename>.<construct-id>.(ts|js)

// Example, if stack.ts contains the following:
new NodejsFunction(this, 'my-handler', { ... });

// Then the implicit entry point(s) will be
stack.my-handler.ts
stack.my-handler.js
```

Again: if the current project is not a Node project this is not reliable,
and instead explicit, absolute paths should be used.

#### Default

```ts
- (Realible in Node projects only) derived from the defining file's name and construct ID as described in the documentation.
```

***

### environment?

> `readonly` `optional` **environment?**: `object`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:173

Key-value pairs that Lambda caches and makes available for your Lambda
functions. Use environment variables to apply configuration changes, such
as test and production environment configurations, without changing your
Lambda function source code.

#### Index Signature

\[`key`: `string`\]: `string`

#### Default

```ts
- No environment variables.
```

***

### environmentEncryption?

> `readonly` `optional` **environmentEncryption?**: `IKeyRef`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:465

The AWS KMS key that's used to encrypt your function's environment variables.

#### Default

```ts
- AWS Lambda creates and uses an AWS managed customer master key (CMK).
```

***

### ephemeralStorageSize?

> `readonly` `optional` **ephemeralStorageSize?**: `Size`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:197

The size of the function’s /tmp directory in MiB.

#### Default

```ts
512 MiB
```

***

### events?

> `readonly` `optional` **events?**: `IEventSource`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:384

Event sources for this function.

You can also add event sources using `addEventSource`.

#### Default

```ts
- No event sources.
```

***

### filesystem?

> `readonly` `optional` **filesystem?**: `FileSystem`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:451

The filesystem configuration for the lambda function

#### Default

```ts
- will not mount any filesystem
```

***

### initialPolicy?

> `readonly` `optional` **initialPolicy?**: `PolicyStatement`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:205

Initial policy statements to add to the created Lambda Role.

You can call `addToRolePolicy` to the created lambda to add statements post creation.

#### Default

```ts
- No policy statements are added to the created Lambda role.
```

***

### insightsVersion?

> `readonly` `optional` **insightsVersion?**: `LambdaInsightsVersion`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:346

Specify the version of CloudWatch Lambda insights to use for monitoring

#### See

 - https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights.html

When used with `DockerImageFunction` or `DockerImageCode`, the Docker image should have
the Lambda insights agent installed.
 - https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-Getting-Started-docker.html

#### Default

```ts
- No Lambda Insights
```

***

### ipv6AllowedForDualStack?

> `readonly` `optional` **ipv6AllowedForDualStack?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:239

Allows outbound IPv6 traffic on VPC functions that are connected to dual-stack subnets.

Only used if 'vpc' is supplied.

#### Default

```ts
false
```

***

### layers?

> `readonly` `optional` **layers?**: `ILayerVersion`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:369

A list of layers to add to the function's execution environment. You can configure your Lambda function to pull in
additional code during initialization in the form of layers. Layers are packages of libraries or other dependencies
that can be used by multiple functions.

#### Default

```ts
- No layers.
```

***

### ~~logFormat?~~

> `readonly` `optional` **logFormat?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:516

Sets the logFormat for the function.

:::caution[Deprecated]
Use `loggingFormat` as a property instead.
:::

#### Default

```ts
"Text"
```

***

### loggingFormat?

> `readonly` `optional` **loggingFormat?**: `LoggingFormat`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:521

Sets the loggingFormat for the function.

#### Default

```ts
LoggingFormat.TEXT
```

***

### logGroup?

> `readonly` `optional` **logGroup?**: `ILogGroupRef`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:510

The log group the function sends logs to.

By default, Lambda functions send logs to an automatically created default log group named /aws/lambda/\<function name\>.
However you cannot change the properties of this auto-created log group using the AWS CDK, e.g. you cannot set a different log retention.

Use the `logGroup` property to create a fully customizable LogGroup ahead of time, and instruct the Lambda function to send logs to it.

Providing a user-controlled log group was rolled out to commercial regions on 2023-11-16.
If you are deploying to another type of region, please check regional availability first.

#### Default

`/aws/lambda/${this.functionName}` - default log group created by Lambda

***

### ~~logRemovalPolicy?~~

> `readonly` `optional` **logRemovalPolicy?**: `RemovalPolicy`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:419

Determine the removal policy of the log group that is auto-created by this construct.

Normally you want to retain the log group so you can diagnose issues
from logs even after a deployment that no longer includes the log group.
In that case, use the normal date-based retention policy to age out your
logs.

:::caution[Deprecated]
use `logGroup` instead
:::

#### Default

```ts
RemovalPolicy.Retain
```

***

### ~~logRetention?~~

> `readonly` `optional` **logRetention?**: `RetentionDays`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:407

The number of days log events are kept in CloudWatch Logs. When updating
this property, unsetting it doesn't remove the log retention policy. To
remove the retention policy, set the value to `INFINITE`.

This is a legacy API and we strongly recommend you move away from it if you can.
Instead create a fully customizable log group with `logs.LogGroup` and use the `logGroup` property
to instruct the Lambda function to send logs to it.
Migrating from `logRetention` to `logGroup` will cause the name of the log group to change.
Users and code and referencing the name verbatim will have to adjust.

In AWS CDK code, you can access the log group name directly from the LogGroup construct:
```ts
import * as logs from 'aws-cdk-lib/aws-logs';

declare const myLogGroup: logs.LogGroup;
myLogGroup.logGroupName;
```

:::caution[Deprecated]
use `logGroup` instead
:::

#### Default

```ts
logs.RetentionDays.INFINITE
```

***

### logRetentionRetryOptions?

> `readonly` `optional` **logRetentionRetryOptions?**: `LogRetentionRetryOptions`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:439

When log retention is specified, a custom resource attempts to create the CloudWatch log group.
These options control the retry policy when interacting with CloudWatch APIs.

This is a legacy API and we strongly recommend you migrate to `logGroup` if you can.
`logGroup` allows you to create a fully customizable log group and instruct the Lambda function to send logs to it.

#### Default

```ts
- Default AWS SDK retry options.
```

***

### logRetentionRole?

> `readonly` `optional` **logRetentionRole?**: `IRole`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:429

The IAM role for the Lambda function associated with the custom resource
that sets the retention policy.

This is a legacy API and we strongly recommend you migrate to `logGroup` if you can.
`logGroup` allows you to create a fully customizable log group and instruct the Lambda function to send logs to it.

#### Default

```ts
- A new role is created.
```

***

### maxEventAge?

> `readonly` `optional` **maxEventAge?**: [`Duration`](/cdk/classes/duration/)

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:31

The maximum age of a request that Lambda sends to a function for
processing.

Minimum: 60 seconds
Maximum: 6 hours

#### Default

```ts
Duration.hours(6)
```

***

### memorySize?

> `readonly` `optional` **memorySize?**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:191

The amount of memory, in MB, that is allocated to your Lambda function.
Lambda uses this value to proportionally allocate the amount of CPU
power. For more information, see Resource Model in the AWS Lambda
Developer Guide.

#### Default

```ts
128
```

***

### onFailure?

> `readonly` `optional` **onFailure?**: `IDestination`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:15

The destination for failed invocations.

#### Default

```ts
- no destination
```

***

### onSuccess?

> `readonly` `optional` **onSuccess?**: `IDestination`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:21

The destination for successful invocations.

#### Default

```ts
- no destination
```

***

### paramsAndSecrets?

> `readonly` `optional` **paramsAndSecrets?**: `ParamsAndSecretsLayerVersion`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:361

Specify the configuration of Parameters and Secrets Extension

#### See

 - https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
 - https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html

#### Default

```ts
- No Parameters and Secrets Extension
```

***

### permissions?

> `optional` **permissions?**: `ConstructPermission`[]

Defined in: [packages/cdk/src/basic-construct.ts:28](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L28)

Optional permissions to grant during creation

***

### profiling?

> `readonly` `optional` **profiling?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:328

Enable profiling.

#### See

https://docs.aws.amazon.com/codeguru/latest/profiler-ug/setting-up-lambda.html

#### Default

```ts
- No profiling.
```

***

### profilingGroup?

> `readonly` `optional` **profilingGroup?**: `IProfilingGroup`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:335

Profiling Group.

#### See

https://docs.aws.amazon.com/codeguru/latest/profiler-ug/setting-up-lambda.html

#### Default

- A new profiling group will be created if `profiling` is set.

***

### projectRoot?

> `readonly` `optional` **projectRoot?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:104

The path to the directory containing project config files (`package.json` or `tsconfig.json`)

#### Default

- the directory containing the `depsLockFilePath`

***

### recursiveLoop?

> `readonly` `optional` **recursiveLoop?**: `RecursiveLoop`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:528

Sets the Recursive Loop Protection for Lambda Function.
It lets Lambda detect and terminate unintended recursive loops.

#### Default

```ts
RecursiveLoop.Terminate
```

***

### reservedConcurrentExecutions?

> `readonly` `optional` **reservedConcurrentExecutions?**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:376

The maximum of concurrent executions you want to reserve for the function.

#### Default

```ts
- No specific limit - account limit.
```

#### See

https://docs.aws.amazon.com/lambda/latest/dg/concurrent-executions.html

***

### retryAttempts?

> `readonly` `optional` **retryAttempts?**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:40

The maximum number of times to retry when the function returns an error.

Minimum: 0
Maximum: 2

#### Default

```ts
2
```

***

### role?

> `readonly` `optional` **role?**: `IRole`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:222

Lambda execution role.

This is the role that will be assumed by the function upon execution.
It controls the permissions that the function will have. The Role must
be assumable by the 'lambda.amazonaws.com' service principal.

The default Role automatically has permissions granted for Lambda execution. If you
provide a Role, you must add the relevant AWS managed policies yourself.

The relevant managed policies are "service-role/AWSLambdaBasicExecutionRole" and
"service-role/AWSLambdaVPCAccessExecutionRole".

#### Default

- A unique role will be generated for this lambda function.
Both supplied and generated roles can always be changed by calling `addToRolePolicy`.

***

### runtimeManagementMode?

> `readonly` `optional` **runtimeManagementMode?**: `RuntimeManagementMode`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:481

Sets the runtime management configuration for a function's version.

#### Default

```ts
Auto
```

***

### securityGroups?

> `readonly` `optional` **securityGroups?**: `ISecurityGroup`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:261

The list of security groups to associate with the Lambda's network interfaces.

Only used if 'vpc' is supplied.

#### Default

```ts
- If the function is placed within a VPC and a security group is
not specified, either by this or securityGroup prop, a dedicated security
group will be created for this function.
```

***

### snapStart?

> `readonly` `optional` **snapStart?**: `SnapStartConf`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:321

Enable SnapStart for Lambda Function.
SnapStart is currently supported for Java 11, Java 17, Python 3.12, Python 3.13, and .NET 8 runtime

#### Default

```ts
- No snapstart
```

***

### ~~systemLogLevel?~~

> `readonly` `optional` **systemLogLevel?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:545

Sets the system log level for the function.

:::caution[Deprecated]
Use `systemLogLevelV2` as a property instead.
:::

#### Default

```ts
"INFO"
```

***

### systemLogLevelV2?

> `readonly` `optional` **systemLogLevelV2?**: `SystemLogLevel`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:550

Sets the system log level for the function.

#### Default

```ts
SystemLogLevel.INFO
```

***

### tenancyConfig?

> `readonly` `optional` **tenancyConfig?**: `TenancyConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:487

The tenancy configuration for the function.

#### Default

```ts
- Tenant isolation is not enabled
```

***

### timeout?

> `readonly` `optional` **timeout?**: [`Duration`](/cdk/classes/duration/)

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:164

The function execution time (in seconds) after which Lambda terminates
the function. Because the execution time affects cost, set this value
based on the function's expected execution time.

#### Default

```ts
Duration.seconds(3)
```

***

### tracing?

> `readonly` `optional` **tracing?**: `Tracing`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:314

Enable AWS X-Ray Tracing for Lambda Function.

#### Default

```ts
Tracing.Disabled
```

***

### vpc?

> `readonly` `optional` **vpc?**: `IVpc`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:231

VPC network to place Lambda network interfaces

Specify this if the Lambda function needs to access resources in a VPC.
This is required when `vpcSubnets` is specified.

#### Default

```ts
- Function is not placed within a VPC.
```

***

### vpcSubnets?

> `readonly` `optional` **vpcSubnets?**: `SubnetSelection`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:251

Where to place the network interfaces within the VPC.

This requires `vpc` to be specified in order for interfaces to actually be
placed in the subnets. If `vpc` is not specify, this will raise an error.

Note: Internet access for Lambda Functions requires a NAT Gateway, so picking
public subnets is not allowed (unless `allowPublicSubnet` is set to `true`).

#### Default

```ts
- the Vpc default strategy if not specified
```
