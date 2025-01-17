---
editUrl: false
next: false
prev: false
title: "LambdaProps"
---

Defined in: packages/cdk/src/lambda-function.ts:11

## Extends

- `Omit`\<`NodejsFunctionProps`, `"code"` \| `"runtime"` \| `"handler"` \| `"architecture"`\>

## Properties

### adotInstrumentation?

> `readonly` `optional` **adotInstrumentation**: `AdotInstrumentationConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:347

Specify the configuration of AWS Distro for OpenTelemetry (ADOT) instrumentation

#### See

https://aws-otel.github.io/docs/getting-started/lambda

#### Default

```ts
- No ADOT instrumentation
```

#### Inherited from

`Omit.adotInstrumentation`

***

### allowAllIpv6Outbound?

> `readonly` `optional` **allowAllIpv6Outbound**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:280

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

#### Inherited from

`Omit.allowAllIpv6Outbound`

***

### allowAllOutbound?

> `readonly` `optional` **allowAllOutbound**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:267

Whether to allow the Lambda to send all network traffic (except ipv6)

If set to false, you must individually add traffic rules to allow the
Lambda to connect to network targets.

Do not specify this property if the `securityGroups` or `securityGroup` property is set.
Instead, configure `allowAllOutbound` directly on the security group.

#### Default

```ts
true
```

#### Inherited from

`Omit.allowAllOutbound`

***

### allowPublicSubnet?

> `readonly` `optional` **allowPublicSubnet**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:440

Lambda Functions in a public subnet can NOT access the internet.
Use this property to acknowledge this limitation and still place the function in a public subnet.

#### See

https://stackoverflow.com/questions/52992085/why-cant-an-aws-lambda-function-inside-a-public-subnet-in-a-vpc-connect-to-the/52994841#52994841

#### Default

```ts
false
```

#### Inherited from

`Omit.allowPublicSubnet`

***

### ~~applicationLogLevel?~~

> `readonly` `optional` **applicationLogLevel**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:500

Sets the application log level for the function.

:::caution[Deprecated]
Use `applicationLogLevelV2` as a property instead.
:::

#### Default

```ts
"INFO"
```

#### Inherited from

`Omit.applicationLogLevel`

***

### applicationLogLevelV2?

> `readonly` `optional` **applicationLogLevelV2**: `ApplicationLogLevel`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:505

Sets the application log level for the function.

#### Default

```ts
ApplicationLogLevel.INFO
```

#### Inherited from

`Omit.applicationLogLevelV2`

***

### authorizer?

> `optional` **authorizer**: `boolean`

Defined in: packages/cdk/src/lambda-function.ts:14

***

### awsSdkConnectionReuse?

> `readonly` `optional` **awsSdkConnectionReuse**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:55

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

#### Inherited from

`Omit.awsSdkConnectionReuse`

***

### bundling?

> `readonly` `optional` **bundling**: `BundlingOptions`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:75

Bundling options

#### Default

```ts
- use default bundling options: no minify, no sourcemap, all
  modules are bundled.
```

#### Inherited from

`Omit.bundling`

***

### codeSigningConfig?

> `readonly` `optional` **codeSigningConfig**: `ICodeSigningConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:452

Code signing config associated with this function

#### Default

```ts
- Not Sign the Code
```

#### Inherited from

`Omit.codeSigningConfig`

***

### currentVersionOptions?

> `readonly` `optional` **currentVersionOptions**: `VersionOptions`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:426

Options for the `lambda.Version` resource automatically created by the
`fn.currentVersion` method.

#### Default

- default options as described in `VersionOptions`

#### Inherited from

`Omit.currentVersionOptions`

***

### deadLetterQueue?

> `readonly` `optional` **deadLetterQueue**: `IQueue`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:294

The SQS queue to use if DLQ is enabled.
If SNS topic is desired, specify `deadLetterTopic` property instead.

#### Default

- SQS queue with 14 day retention period if `deadLetterQueueEnabled` is `true`

#### Inherited from

`Omit.deadLetterQueue`

***

### deadLetterQueueEnabled?

> `readonly` `optional` **deadLetterQueueEnabled**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:287

Enabled DLQ. If `deadLetterQueue` is undefined,
an SQS queue with default options will be defined for your Function.

#### Default

- false unless `deadLetterQueue` is set, which implies DLQ is enabled.

#### Inherited from

`Omit.deadLetterQueueEnabled`

***

### deadLetterTopic?

> `readonly` `optional` **deadLetterTopic**: `ITopic`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:302

The SNS topic to use as a DLQ.
Note that if `deadLetterQueueEnabled` is set to `true`, an SQS queue will be created
rather than an SNS topic. Using an SNS topic as a DLQ requires this property to be set explicitly.

#### Default

```ts
- no SNS topic
```

#### Inherited from

`Omit.deadLetterTopic`

***

### depsLockFilePath?

> `readonly` `optional` **depsLockFilePath**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:68

The path to the dependencies lock file (`yarn.lock`, `pnpm-lock.yaml`, `bun.lockb` or `package-lock.json`).

This will be used as the source for the volume mounted in the Docker
container.

Modules specified in `nodeModules` will be installed using the right
installer (`yarn`, `pnpm`, `bun` or `npm`) along with this lock file.

#### Default

- the path is found by walking up parent directories searching for
  a `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb` or `package-lock.json` file

#### Inherited from

`Omit.depsLockFilePath`

***

### description?

> `readonly` `optional` **description**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:150

A description of the function.

#### Default

```ts
- No description.
```

#### Inherited from

`Omit.description`

***

### entry

> **entry**: `string`

Defined in: packages/cdk/src/lambda-function.ts:13

Path to the entry file (JavaScript or TypeScript).

#### Default

- Derived from the name of the defining file and the construct's id.
If the `NodejsFunction` is defined in `stack.ts` with `my-handler` as id
(`new NodejsFunction(this, 'my-handler')`), the construct will look at `stack.my-handler.ts`
and `stack.my-handler.js`.

#### Overrides

`Omit.entry`

***

### environment?

> `readonly` `optional` **environment**: `object`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:167

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

#### Inherited from

`Omit.environment`

***

### environmentEncryption?

> `readonly` `optional` **environmentEncryption**: `IKey`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:446

The AWS KMS key that's used to encrypt your function's environment variables.

#### Default

```ts
- AWS Lambda creates and uses an AWS managed customer master key (CMK).
```

#### Inherited from

`Omit.environmentEncryption`

***

### ephemeralStorageSize?

> `readonly` `optional` **ephemeralStorageSize**: `Size`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:191

The size of the function’s /tmp directory in MiB.

#### Default

```ts
512 MiB
```

#### Inherited from

`Omit.ephemeralStorageSize`

***

### events?

> `readonly` `optional` **events**: `IEventSource`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:378

Event sources for this function.

You can also add event sources using `addEventSource`.

#### Default

```ts
- No event sources.
```

#### Inherited from

`Omit.events`

***

### filesystem?

> `readonly` `optional` **filesystem**: `FileSystem`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:432

The filesystem configuration for the lambda function

#### Default

```ts
- will not mount any filesystem
```

#### Inherited from

`Omit.filesystem`

***

### functionName?

> `readonly` `optional` **functionName**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:176

A name for the function.

#### Default

```ts
- AWS CloudFormation generates a unique physical ID and uses that
ID for the function's name. For more information, see Name Type.
```

#### Inherited from

`Omit.functionName`

***

### initialPolicy?

> `readonly` `optional` **initialPolicy**: `PolicyStatement`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:199

Initial policy statements to add to the created Lambda Role.

You can call `addToRolePolicy` to the created lambda to add statements post creation.

#### Default

```ts
- No policy statements are added to the created Lambda role.
```

#### Inherited from

`Omit.initialPolicy`

***

### insightsVersion?

> `readonly` `optional` **insightsVersion**: `LambdaInsightsVersion`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:340

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

#### Inherited from

`Omit.insightsVersion`

***

### ipv6AllowedForDualStack?

> `readonly` `optional` **ipv6AllowedForDualStack**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:233

Allows outbound IPv6 traffic on VPC functions that are connected to dual-stack subnets.

Only used if 'vpc' is supplied.

#### Default

```ts
false
```

#### Inherited from

`Omit.ipv6AllowedForDualStack`

***

### layers?

> `readonly` `optional` **layers**: `ILayerVersion`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:363

A list of layers to add to the function's execution environment. You can configure your Lambda function to pull in
additional code during initialization in the form of layers. Layers are packages of libraries or other dependencies
that can be used by multiple functions.

#### Default

```ts
- No layers.
```

#### Inherited from

`Omit.layers`

***

### ~~logFormat?~~

> `readonly` `optional` **logFormat**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:482

Sets the logFormat for the function.

:::caution[Deprecated]
Use `loggingFormat` as a property instead.
:::

#### Default

```ts
"Text"
```

#### Inherited from

`Omit.logFormat`

***

### loggingFormat?

> `readonly` `optional` **loggingFormat**: `LoggingFormat`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:487

Sets the loggingFormat for the function.

#### Default

```ts
LoggingFormat.TEXT
```

#### Inherited from

`Omit.loggingFormat`

***

### logGroup?

> `readonly` `optional` **logGroup**: `ILogGroup`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:476

The log group the function sends logs to.

By default, Lambda functions send logs to an automatically created default log group named /aws/lambda/\<function name\>.
However you cannot change the properties of this auto-created log group using the AWS CDK, e.g. you cannot set a different log retention.

Use the `logGroup` property to create a fully customizable LogGroup ahead of time, and instruct the Lambda function to send logs to it.

Providing a user-controlled log group was rolled out to commercial regions on 2023-11-16.
If you are deploying to another type of region, please check regional availability first.

#### Default

`/aws/lambda/${this.functionName}` - default log group created by Lambda

#### Inherited from

`Omit.logGroup`

***

### logRetention?

> `readonly` `optional` **logRetention**: `RetentionDays`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:400

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

#### Default

```ts
logs.RetentionDays.INFINITE
```

#### Inherited from

`Omit.logRetention`

***

### logRetentionRetryOptions?

> `readonly` `optional` **logRetentionRetryOptions**: `LogRetentionRetryOptions`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:420

When log retention is specified, a custom resource attempts to create the CloudWatch log group.
These options control the retry policy when interacting with CloudWatch APIs.

This is a legacy API and we strongly recommend you migrate to `logGroup` if you can.
`logGroup` allows you to create a fully customizable log group and instruct the Lambda function to send logs to it.

#### Default

```ts
- Default AWS SDK retry options.
```

#### Inherited from

`Omit.logRetentionRetryOptions`

***

### logRetentionRole?

> `readonly` `optional` **logRetentionRole**: `IRole`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:410

The IAM role for the Lambda function associated with the custom resource
that sets the retention policy.

This is a legacy API and we strongly recommend you migrate to `logGroup` if you can.
`logGroup` allows you to create a fully customizable log group and instruct the Lambda function to send logs to it.

#### Default

```ts
- A new role is created.
```

#### Inherited from

`Omit.logRetentionRole`

***

### maxEventAge?

> `readonly` `optional` **maxEventAge**: `Duration`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:30

The maximum age of a request that Lambda sends to a function for
processing.

Minimum: 60 seconds
Maximum: 6 hours

#### Default

```ts
Duration.hours(6)
```

#### Inherited from

`Omit.maxEventAge`

***

### memorySize?

> `readonly` `optional` **memorySize**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:185

The amount of memory, in MB, that is allocated to your Lambda function.
Lambda uses this value to proportionally allocate the amount of CPU
power. For more information, see Resource Model in the AWS Lambda
Developer Guide.

#### Default

```ts
128
```

#### Inherited from

`Omit.memorySize`

***

### onFailure?

> `readonly` `optional` **onFailure**: `IDestination`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:14

The destination for failed invocations.

#### Default

```ts
- no destination
```

#### Inherited from

`Omit.onFailure`

***

### onSuccess?

> `readonly` `optional` **onSuccess**: `IDestination`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:20

The destination for successful invocations.

#### Default

```ts
- no destination
```

#### Inherited from

`Omit.onSuccess`

***

### paramsAndSecrets?

> `readonly` `optional` **paramsAndSecrets**: `ParamsAndSecretsLayerVersion`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:355

Specify the configuration of Parameters and Secrets Extension

#### See

 - https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
 - https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html

#### Default

```ts
- No Parameters and Secrets Extension
```

#### Inherited from

`Omit.paramsAndSecrets`

***

### profiling?

> `readonly` `optional` **profiling**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:322

Enable profiling.

#### See

https://docs.aws.amazon.com/codeguru/latest/profiler-ug/setting-up-lambda.html

#### Default

```ts
- No profiling.
```

#### Inherited from

`Omit.profiling`

***

### profilingGroup?

> `readonly` `optional` **profilingGroup**: `IProfilingGroup`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:329

Profiling Group.

#### See

https://docs.aws.amazon.com/codeguru/latest/profiler-ug/setting-up-lambda.html

#### Default

- A new profiling group will be created if `profiling` is set.

#### Inherited from

`Omit.profilingGroup`

***

### projectRoot?

> `readonly` `optional` **projectRoot**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.d.ts:81

The path to the directory containing project config files (`package.json` or `tsconfig.json`)

#### Default

- the directory containing the `depsLockFilePath`

#### Inherited from

`Omit.projectRoot`

***

### recursiveLoop?

> `readonly` `optional` **recursiveLoop**: `RecursiveLoop`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:494

Sets the Recursive Loop Protection for Lambda Function.
It lets Lambda detect and terminate unintended recursive loops.

#### Default

```ts
RecursiveLoop.Terminate
```

#### Inherited from

`Omit.recursiveLoop`

***

### reservedConcurrentExecutions?

> `readonly` `optional` **reservedConcurrentExecutions**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:370

The maximum of concurrent executions you want to reserve for the function.

#### Default

```ts
- No specific limit - account limit.
```

#### See

https://docs.aws.amazon.com/lambda/latest/dg/concurrent-executions.html

#### Inherited from

`Omit.reservedConcurrentExecutions`

***

### retryAttempts?

> `readonly` `optional` **retryAttempts**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:39

The maximum number of times to retry when the function returns an error.

Minimum: 0
Maximum: 2

#### Default

```ts
2
```

#### Inherited from

`Omit.retryAttempts`

***

### role?

> `readonly` `optional` **role**: `IRole`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:216

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

#### Inherited from

`Omit.role`

***

### runtimeManagementMode?

> `readonly` `optional` **runtimeManagementMode**: `RuntimeManagementMode`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:462

Sets the runtime management configuration for a function's version.

#### Default

```ts
Auto
```

#### Inherited from

`Omit.runtimeManagementMode`

***

### securityGroups?

> `readonly` `optional` **securityGroups**: `ISecurityGroup`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:255

The list of security groups to associate with the Lambda's network interfaces.

Only used if 'vpc' is supplied.

#### Default

```ts
- If the function is placed within a VPC and a security group is
not specified, either by this or securityGroup prop, a dedicated security
group will be created for this function.
```

#### Inherited from

`Omit.securityGroups`

***

### snapStart?

> `readonly` `optional` **snapStart**: `SnapStartConf`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:315

Enable SnapStart for Lambda Function.
SnapStart is currently supported for Java 11, Java 17, Python 3.12, Python 3.13, and .NET 8 runtime

#### Default

```ts
- No snapstart
```

#### Inherited from

`Omit.snapStart`

***

### ~~systemLogLevel?~~

> `readonly` `optional` **systemLogLevel**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:511

Sets the system log level for the function.

:::caution[Deprecated]
Use `systemLogLevelV2` as a property instead.
:::

#### Default

```ts
"INFO"
```

#### Inherited from

`Omit.systemLogLevel`

***

### systemLogLevelV2?

> `readonly` `optional` **systemLogLevelV2**: `SystemLogLevel`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:516

Sets the system log level for the function.

#### Default

```ts
SystemLogLevel.INFO
```

#### Inherited from

`Omit.systemLogLevelV2`

***

### timeout?

> `readonly` `optional` **timeout**: `Duration`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:158

The function execution time (in seconds) after which Lambda terminates
the function. Because the execution time affects cost, set this value
based on the function's expected execution time.

#### Default

```ts
Duration.seconds(3)
```

#### Inherited from

`Omit.timeout`

***

### tracing?

> `readonly` `optional` **tracing**: `Tracing`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:308

Enable AWS X-Ray Tracing for Lambda Function.

#### Default

```ts
Tracing.Disabled
```

#### Inherited from

`Omit.tracing`

***

### vpc?

> `readonly` `optional` **vpc**: `IVpc`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:225

VPC network to place Lambda network interfaces

Specify this if the Lambda function needs to access resources in a VPC.
This is required when `vpcSubnets` is specified.

#### Default

```ts
- Function is not placed within a VPC.
```

#### Inherited from

`Omit.vpc`

***

### vpcSubnets?

> `readonly` `optional` **vpcSubnets**: `SubnetSelection`

Defined in: node\_modules/aws-cdk-lib/aws-lambda/lib/function.d.ts:245

Where to place the network interfaces within the VPC.

This requires `vpc` to be specified in order for interfaces to actually be
placed in the subnets. If `vpc` is not specify, this will raise an error.

Note: Internet access for Lambda Functions requires a NAT Gateway, so picking
public subnets is not allowed (unless `allowPublicSubnet` is set to `true`).

#### Default

```ts
- the Vpc default strategy if not specified
```

#### Inherited from

`Omit.vpcSubnets`
