import { Arn, ArnFormat, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  type BuildEnvironmentVariable,
  BuildEnvironmentVariableType,
  BuildSpec,
  type CfnProject,
  ComputeType,
  LinuxBuildImage,
  Project,
  Source,
} from "aws-cdk-lib/aws-codebuild";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
  type ISecurityGroup,
  type IVpc,
  Peer,
  Port,
  SecurityGroup,
  type SubnetSelection,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  Effect,
  PolicyStatement as IamPolicyStatement,
  Policy,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { z } from "zod";
import {
  BasicConstruct,
  type BasicConstructProps,
  type PolicyStatement,
} from "./basic-construct";
import {
  normalizeRepositoryTarget,
  type RepositoryTarget,
} from "./codecommit-repository";
import { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

const nonEmptyString = z.string().trim().min(1);

export const CodeBuildComputeSizeSchema = z.enum(["SMALL", "MEDIUM", "LARGE"]);
export type CodeBuildComputeSize = z.infer<typeof CodeBuildComputeSizeSchema>;

const vpcIdSchema = z.string().regex(/^vpc-[0-9a-f]{8,17}$/);
const subnetIdSchema = z.string().regex(/^subnet-[0-9a-f]{8,17}$/);
const securityGroupIdSchema = z.string().regex(/^sg-[0-9a-f]{8,17}$/);
const prefixListIdSchema = z.string().regex(/^pl-[0-9a-f]{8,17}$/);

export const CodeBuildProjectNameSchema = z
  .string()
  .min(2)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const CodeArtifactPackageAccessSchema = z
  .object({
    mode: z.literal("codeartifact"),
    domain: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
    domainOwner: z.string().regex(/^\d{12}$/),
    repository: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]+$/),
    endpointSecurityGroupIds: z.array(securityGroupIdSchema),
    prefixListIds: z.array(prefixListIdSchema),
  })
  .refine(
    (value) =>
      value.endpointSecurityGroupIds.length > 0 ||
      value.prefixListIds.length > 0,
    {
      message:
        "Private package access requires at least one endpoint security group or prefix list",
    },
  );
export type CodeArtifactPackageAccess = z.infer<
  typeof CodeArtifactPackageAccessSchema
>;

export const PrivateCodeBuildNetworkPolicySchema = z.object({
  mode: z.literal("private"),
  vpcId: vpcIdSchema,
  availabilityZones: z.array(nonEmptyString).min(1),
  privateSubnetIds: z.array(subnetIdSchema).min(1),
  packageAccess: CodeArtifactPackageAccessSchema,
});
export type PrivateCodeBuildNetworkPolicy = z.infer<
  typeof PrivateCodeBuildNetworkPolicySchema
>;

export const ApprovedRegistryPackageAccessSchema = z.object({
  mode: z.literal("approved-registry"),
  endpoint: nonEmptyString
    .url()
    .refine(
      (value) => value.startsWith("https://"),
      "Approved registry endpoint must use HTTPS",
    ),
});
export type ApprovedRegistryPackageAccess = z.infer<
  typeof ApprovedRegistryPackageAccessSchema
>;

export const PublicTestCodeBuildNetworkPolicySchema = z.object({
  mode: z.literal("public-test"),
  packageAccess: ApprovedRegistryPackageAccessSchema,
});
export type PublicTestCodeBuildNetworkPolicy = z.infer<
  typeof PublicTestCodeBuildNetworkPolicySchema
>;

export const CodeBuildNetworkPolicySchema = z.discriminatedUnion("mode", [
  PrivateCodeBuildNetworkPolicySchema,
  PublicTestCodeBuildNetworkPolicySchema,
]);
export type CodeBuildNetworkPolicy = z.infer<
  typeof CodeBuildNetworkPolicySchema
>;

export const CodeBuildProjectConfigSchema = z.object({
  timeoutMinutes: z.number().int().min(5).max(60).default(30),
  computeSize: CodeBuildComputeSizeSchema.default("SMALL"),
  logRetentionDays: z
    .nativeEnum(RetentionDays)
    .default(RetentionDays.ONE_MONTH),
  networkPolicy: CodeBuildNetworkPolicySchema,
});
export type CodeBuildProjectConfig = z.infer<
  typeof CodeBuildProjectConfigSchema
>;

/**
 * Selects a CodeCommit source for a CodeBuild project by name or by a
 * concrete repository resource.
 *
 * Provide either a `repositoryName` string (imported by name) or a concrete
 * `repository` resource (preserves identity and source ARN). Providing both
 * or neither is a runtime error.
 */
export type CodeBuildRepositoryTarget =
  | {
    repositoryName: string;
    repository?: never;
  }
  | {
    repository: Repository;
    repositoryName?: never;
  };

export type CodeBuildProjectProps =
  | (CodeBuildRepositoryTarget &
    z.input<typeof CodeBuildProjectConfigSchema> &
    BasicConstructProps & { readonly pipelineMode?: false })
  | (z.input<typeof CodeBuildProjectConfigSchema> &
    BasicConstructProps & {
      readonly pipelineMode: true;
      /**
       * Inline buildspec for pipeline mode. When omitted, a placeholder
       * buildspec that succeeds immediately is used — CodeBuild would
       * otherwise fail with `YAML_FILE_ERROR` when the source repository
       * has no `buildspec.yml` at its root.
       */
      readonly buildSpec?: BuildSpec;
    });

function normalizeCodeBuildRepositoryTarget(
  scope: Construct,
  id: string,
  target: CodeBuildRepositoryTarget,
): Repository {
  const hasRepository = target.repository !== undefined;
  const hasRepositoryName = target.repositoryName !== undefined;
  if (hasRepository === hasRepositoryName) {
    throw new Error(
      "CodeBuild repository target must provide exactly one of repository or repositoryName",
    );
  }
  if (
    target.repository !== undefined &&
    !(target.repository instanceof Repository)
  ) {
    throw new Error(
      "CodeBuild repository target must be a concrete Repository",
    );
  }

  return normalizeRepositoryTarget(scope, id, target as RepositoryTarget)
    .repository as Repository;
}

const computeTypes: Record<CodeBuildComputeSize, ComputeType> = {
  SMALL: ComputeType.SMALL,
  MEDIUM: ComputeType.MEDIUM,
  LARGE: ComputeType.LARGE,
};

/** A secure, bounded CodeBuild project for Pawl review jobs. */
export class CodeBuildProject extends BasicConstruct {
  readonly project: Project;
  readonly repository: Repository;
  readonly logGroup: LogGroup;
  readonly projectName: string;
  readonly projectArn: string;
  readonly logGroupName: string;
  readonly logGroupArn: string;
  readonly projectSecurityGroup?: ISecurityGroup;

  constructor(scope: Stack, id: string, props: CodeBuildProjectProps) {
    super(scope, id);

    const { permissions, pipelineMode, buildSpec: pipelineBuildSpec, ...configInput } = props as Record<
      string,
      unknown
    > & {
      permissions?: unknown;
      pipelineMode?: boolean;
      buildSpec?: BuildSpec;
    };
    const isPipelineMode = pipelineMode === true;

    if (!isPipelineMode) {
      const { repository, repositoryName } = props as CodeBuildRepositoryTarget;
      this.repository = normalizeCodeBuildRepositoryTarget(this, "Repository", {
        repository,
        repositoryName,
      } as CodeBuildRepositoryTarget);
    } else {
      this.repository = undefined as unknown as Repository;
    }
    const config = CodeBuildProjectConfigSchema.parse(configInput);
    const projectName = CodeBuildProjectNameSchema.parse(
      `${this.prefix}${id}-codebuild`,
    );
    if (
      config.networkPolicy.mode === "public-test" &&
      scope.node.tryGetContext("stage") === "prod"
    ) {
      throw new Error(
        "The public-test CodeBuild network policy is not allowed in prod",
      );
    }

    const encryptionKey = new Key(this, "EncryptionKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // CloudWatch Logs must be permitted to use the key to encrypt/decrypt the
    // project's log group. Without this statement, CreateLogGroup fails with
    // "the specified KMS key is not allowed to be used" at deploy time.
    encryptionKey.addToResourcePolicy(
      new IamPolicyStatement({
        effect: Effect.ALLOW,
        principals: [
          new ServicePrincipal(`logs.${this.stack.region}.amazonaws.com`),
        ],
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:DescribeKey",
          "kms:GenerateDataKey*",
        ],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn": `arn:${this.stack.partition}:logs:${this.stack.region}:${this.stack.account}:log-group:*`,
          },
        },
      }),
    );
    this.logGroup = new LogGroup(this, "LogGroup", {
      encryptionKey,
      retention: config.logRetentionDays,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    let vpc: IVpc | undefined;
    let subnetSelection: SubnetSelection | undefined;
    if (config.networkPolicy.mode === "private") {
      vpc = Vpc.fromVpcAttributes(this, "Vpc", {
        vpcId: config.networkPolicy.vpcId,
        availabilityZones: config.networkPolicy.availabilityZones,
        privateSubnetIds: config.networkPolicy.privateSubnetIds,
      });
      const securityGroup = new SecurityGroup(this, "ProjectSecurityGroup", {
        vpc,
        allowAllOutbound: false,
        description: "HTTPS-only egress for the Pawl CodeBuild project",
      });
      for (const securityGroupId of config.networkPolicy.packageAccess
        .endpointSecurityGroupIds) {
        securityGroup.addEgressRule(
          Peer.securityGroupId(securityGroupId),
          Port.tcp(443),
          "HTTPS to approved package endpoint",
        );
      }
      for (const prefixListId of config.networkPolicy.packageAccess
        .prefixListIds) {
        securityGroup.addEgressRule(
          Peer.prefixList(prefixListId),
          Port.tcp(443),
          "HTTPS to approved package prefix list",
        );
      }
      this.projectSecurityGroup = securityGroup;
      subnetSelection = { subnets: vpc.privateSubnets };
    }

    const packageAccess = config.networkPolicy.packageAccess;
    const environmentVariables: Record<string, BuildEnvironmentVariable> =
      packageAccess.mode === "codeartifact"
        ? {
          PAWL_PACKAGE_ACCESS_MODE: {
            type: BuildEnvironmentVariableType.PLAINTEXT,
            value: packageAccess.mode,
          },
          CODEARTIFACT_DOMAIN: {
            type: BuildEnvironmentVariableType.PLAINTEXT,
            value: packageAccess.domain,
          },
          CODEARTIFACT_DOMAIN_OWNER: {
            type: BuildEnvironmentVariableType.PLAINTEXT,
            value: packageAccess.domainOwner,
          },
          CODEARTIFACT_REPOSITORY: {
            type: BuildEnvironmentVariableType.PLAINTEXT,
            value: packageAccess.repository,
          },
        }
        : {
          PAWL_PACKAGE_ACCESS_MODE: {
            type: BuildEnvironmentVariableType.PLAINTEXT,
            value: packageAccess.mode,
          },
          PAWL_APPROVED_REGISTRY_ENDPOINT: {
            type: BuildEnvironmentVariableType.PLAINTEXT,
            value: packageAccess.endpoint,
          },
        };

    const pipelinePlaceholderBucket = new Bucket(this, "PipelinePlaceholderBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    NagSuppressions.addResourceSuppressions(pipelinePlaceholderBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "Placeholder bucket for pipeline-mode CodeBuild — never accessed at runtime.",
      },
    ]);
    this.project = new Project(this, "Project", {
      projectName,
      source: isPipelineMode
        ? Source.s3({
          bucket: pipelinePlaceholderBucket,
          path: "pipeline-placeholder",
        })
        : Source.codeCommit({ repository: this.repository }),
      buildSpec: isPipelineMode
        ? (pipelineBuildSpec ??
          BuildSpec.fromObject({
            version: "0.2",
            phases: {
              build: {
                commands: [
                  'echo "No buildspec supplied for pipeline mode; exiting safely."',
                ],
              },
            },
          }))
        : BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                'echo "No approved buildspec was supplied; exiting safely."',
              ],
            },
          },
        }),
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
        computeType: computeTypes[config.computeSize],
        privileged: false,
      },
      environmentVariables,
      timeout: Duration.minutes(config.timeoutMinutes),
      logging: {
        cloudWatch: { enabled: true, logGroup: this.logGroup },
      },
      vpc,
      subnetSelection,
      securityGroups: this.projectSecurityGroup
        ? [this.projectSecurityGroup]
        : undefined,
      ssmSessionPermissions: false,
      grantReportGroupPermissions: false,
    });

    const cfnProject = this.project.node.defaultChild as CfnProject;
    cfnProject.encryptionKey = encryptionKey.keyArn;
    this.project.role?.addToPrincipalPolicy(
      new IamPolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:ReEncryptFrom",
          "kms:ReEncryptTo",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:DescribeKey",
        ],
        resources: [encryptionKey.keyArn],
      }),
    );

    if (packageAccess.mode === "codeartifact") {
      const projectRole = this.project.role;
      if (!projectRole) {
        throw new Error(
          "Cannot grant CodeArtifact access: the CodeBuild project has no service role",
        );
      }
      const domainArn = Arn.format(
        {
          account: packageAccess.domainOwner,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          partition: this.stack.partition,
          region: this.stack.region,
          resource: "domain",
          resourceName: packageAccess.domain,
          service: "codeartifact",
        },
        this.stack,
      );
      const repositoryArn = Arn.format(
        {
          account: packageAccess.domainOwner,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          partition: this.stack.partition,
          region: this.stack.region,
          resource: "repository",
          resourceName: `${packageAccess.domain}/${packageAccess.repository}`,
          service: "codeartifact",
        },
        this.stack,
      );
      // The domain owner must separately deploy cross-account CodeArtifact
      // domain/repository resource policies that trust this project role.
      const codeArtifactPolicy = new Policy(this, "CodeArtifactPolicy", {
        statements: [
          new IamPolicyStatement({
            effect: Effect.ALLOW,
            actions: ["codeartifact:GetAuthorizationToken"],
            resources: [domainArn],
          }),
          new IamPolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              "codeartifact:GetRepositoryEndpoint",
              "codeartifact:ReadFromRepository",
            ],
            resources: [repositoryArn],
          }),
          new IamPolicyStatement({
            effect: Effect.ALLOW,
            actions: ["sts:GetServiceBearerToken"],
            resources: ["*"],
            conditions: {
              StringEquals: {
                "sts:AWSServiceName": "codeartifact.amazonaws.com",
              },
            },
          }),
        ],
      });
      codeArtifactPolicy.attachToRole(projectRole);
      NagSuppressions.addResourceSuppressions(codeArtifactPolicy, [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "STS GetServiceBearerToken does not support resource-level permissions; the CodeArtifact service condition limits token issuance.",
          appliesTo: ["Resource::*"],
        },
      ]);
    }

    this.projectName = this.project.projectName;
    this.projectArn = this.project.projectArn;
    this.logGroupName = this.logGroup.logGroupName;
    this.logGroupArn = this.logGroup.logGroupArn;

    this.suppressLogStreamWildcard(
      this.project.role?.node.tryFindChild("DefaultPolicy"),
    );
    if (permissions) {
      this.grantPermissions(permissions);
    }
    this.createAlarm(this.stack);
  }

  createAlarm(stack: Stack): void {
    stack.monitoring.monitorCodeBuildProject({ project: this.project });
  }

  /**
   * Grant one Lambda reviewer the ability to run this project and read its logs.
   *
   * StartBuild accepts buildspec, environment, image, and service-role overrides.
   * The reviewer runtime must never derive those overrides or package-registry
   * settings from pull-request content, and it must not receive iam:PassRole.
   * This project's fixed values are safe defaults, not an IAM condition boundary.
   */
  grantRunAndRead(reviewer: LambdaFunction): this {
    const reviewerRole = reviewer.lambda.role;
    if (!reviewerRole) {
      throw new Error(
        "Cannot grant CodeBuildProject permissions: the LambdaFunction has no execution role",
      );
    }
    const policyId = `ReviewerRunAndReadPolicy${reviewerRole.node.addr}`;
    if (this.node.tryFindChild(policyId)) return this;

    const reviewerPolicy = new Policy(this, policyId, {
      statements: [
        new IamPolicyStatement({
          effect: Effect.ALLOW,
          actions: ["codebuild:StartBuild"],
          resources: [this.projectArn],
        }),
        new IamPolicyStatement({
          effect: Effect.ALLOW,
          // BatchGetBuilds is authorized against the project resource (the build
          // ARN format is arn:...:build/<uuid>, which cannot be scoped by
          // project name — AWS evaluates the action against the owning project).
          actions: ["codebuild:BatchGetBuilds"],
          resources: [this.projectArn],
        }),
        new IamPolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "logs:DescribeLogStreams",
            "logs:GetLogEvents",
            "logs:FilterLogEvents",
          ],
          resources: [this.logGroupArn, `${this.logGroupArn}:*`],
        }),
      ],
    });
    reviewerPolicy.attachToRole(reviewerRole);
    this.suppressReviewerWildcards(reviewerPolicy);
    return this;
  }

  protected applyPermissionPolicy(
    construct: Construct,
    policyStatement: PolicyStatement,
  ): void {
    if (!(construct instanceof LambdaFunction)) {
      throw new Error(
        "CodeBuildProject permissions can only be granted to a LambdaFunction",
      );
    }
    this.addToLambdaRole(
      construct,
      new IamPolicyStatement({
        effect: policyStatement.effect === "allow" ? Effect.ALLOW : Effect.DENY,
        actions: policyStatement.actions,
        resources: [policyStatement.resource ?? this.projectArn],
      }),
    );
  }

  private addToLambdaRole(
    reviewer: LambdaFunction,
    statement: IamPolicyStatement,
  ): void {
    const role = reviewer.lambda.role;
    if (!role) {
      throw new Error(
        "Cannot grant CodeBuildProject permissions: the LambdaFunction has no execution role",
      );
    }
    role.addToPrincipalPolicy(statement);
  }

  private suppressReviewerWildcards(policy: Policy): void {
    this.suppressLogStreamWildcard(policy);
    NagSuppressions.addResourceSuppressions(policy, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CodeBuild build ARNs append a service-generated build ID; the wildcard remains bounded to this exact project name.",
        appliesTo: [
          {
            regex:
              "/^Resource::arn:<AWS::Partition>:codebuild:<AWS::Region>:<AWS::AccountId>:build/<.+>:\\*$/",
          },
        ],
      },
    ]);
  }

  private suppressLogStreamWildcard(policy: Construct | undefined): void {
    if (!policy) return;
    NagSuppressions.addResourceSuppressions(policy, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CodeBuild log stream names contain build IDs that are unavailable at synthesis; access remains bounded to this dedicated log group.",
        appliesTo: [
          {
            regex: "/^Resource::<.+LogGroup.+Arn>:\\*$/",
          },
          {
            regex:
              "/^Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/codebuild/<.+>:\\*$/",
          },
        ],
      },
    ]);
  }
}
