import { z } from "zod";
import { CodeCommitAutoReviewer } from "./codecommit-auto-reviewer";
import { CodeCommitReviewEvents } from "./codecommit-review-events";
import type { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

const nonEmptyString = z.string().trim().min(1);

const repositoryNameSchema = nonEmptyString.regex(
  /^[A-Za-z0-9._-]+$/,
  "repository names may contain letters, digits, . _ -",
);

/**
 * Configuration for the auto-reviewer when opted in via `autoReview`.
 *
 * `modelId` is required; all other fields are optional with documented defaults
 * (see `CodeCommitAutoReviewerConfigSchema`). `repositories` is NOT accepted
 * here — the single `repositoryName` passed to `CodeCommit` is used.
 */
const autoReviewConfigSchema = z.object({
  modelId: nonEmptyString,
  reviewerAlias: z.string().trim().min(1).default("live"),
  reviewerExecutionTimeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(31_622_400)
    .default(2_592_000),
  reviewerRetentionDays: z.number().int().min(1).max(90).default(14),
  reviewerTimeoutMinutes: z.number().int().min(1).max(15).default(15),
  reviewerMemorySize: z.number().int().min(128).max(10_240).default(512),
  codeBuildComputeSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).default("SMALL"),
  codeBuildNetworkPolicy: z
    .object({
      mode: z.literal("public-test"),
      packageAccess: z.object({
        mode: z.literal("approved-registry"),
        endpoint: z
          .string()
          .trim()
          .url()
          .refine((v) => v.startsWith("https://"), "must be HTTPS"),
      }),
    })
    .default({
      mode: "public-test",
      packageAccess: {
        mode: "approved-registry",
        endpoint: "https://registry.npmjs.org",
      },
    }),
  botArnPatterns: z.string().default(""),
});

export type AutoReviewConfig = z.input<typeof autoReviewConfigSchema>;

export interface CodeCommitProps {
  /** CodeCommit repository name. */
  readonly repositoryName: string;
  /**
   * Pawl Lambda that receives EventBridge events. Required when `autoReview`
   * is not set. Ignored when `autoReview` is set (the construct creates its
   * own router).
   */
  readonly router?: LambdaFunction;
  /**
   * When set, deploys the full durable auto-reviewer (reviewer Lambda, router
   * Lambda, state table, CodeBuild project, Bedrock IAM, event routing) for
   * this repository. When absent, the construct is a thin wrapper around
   * `CodeCommitReviewEvents` and `router` is required.
   */
  readonly autoReview?: AutoReviewConfig;
}

/**
 * High-level CodeCommit construct with optional auto-review.
 *
 * When `autoReview` is set, the construct deploys a `CodeCommitAutoReviewer`
 * (durable reviewer Lambda, router, state table, CodeBuild, Bedrock IAM) for
 * the repository and wires event routing automatically. The consumer does not
 * need to supply a `router` — one is created internally.
 *
 * When `autoReview` is absent, the construct behaves as a thin wrapper around
 * `CodeCommitReviewEvents` and the consumer must supply a `router` Lambda.
 *
 * @example Opt into auto-review:
 * ```typescript
 * new CodeCommit(this, "Repo", {
 *   repositoryName: "my-repo",
 *   autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
 * });
 * ```
 */
export class CodeCommit {
  readonly events: CodeCommitReviewEvents;
  readonly autoReviewer?: CodeCommitAutoReviewer;

  constructor(scope: Stack, id: string, props: CodeCommitProps) {
    const repositoryName = repositoryNameSchema.parse(props.repositoryName);

    if (props.autoReview !== undefined) {
      const config = autoReviewConfigSchema.parse(props.autoReview);
      this.autoReviewer = new CodeCommitAutoReviewer(
        scope,
        `${id}AutoReviewer`,
        {
          ...config,
          reviewerModelId: config.modelId,
          repositories: [repositoryName],
        },
      );
      // The auto-reviewer creates its own CodeCommitReviewEvents internally.
      this.events = this.autoReviewer.eventConstructs.get(repositoryName)!;
    } else {
      if (props.router === undefined) {
        throw new Error(
          "CodeCommit: router is required when autoReview is not set",
        );
      }
      this.events = new CodeCommitReviewEvents(scope, `${id}Events`, {
        repositoryName,
        router: props.router,
      });
    }
  }
}
