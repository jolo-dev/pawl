# Blog Design: Introducing pawl

## Goal

Write a blog post explaining what pawl is, why it exists, and the infrastructure problem it tries to solve. The post will be saved outside the repository at:

`/Users/jolo/Documents/Obsidian Vault/Blogs/Pawl — Opinionated AWS Infrastructure.md`

## Audience and voice

- Audience: both engineers broadly interested in the problem and AWS/TypeScript developers evaluating pawl.
- Voice: hybrid narrative and technical overview.
- Begin with the recurring engineering problem, then progressively add implementation detail.
- Explain the motivation without presenting unsupported personal history or claiming production adoption unless the repository supports it.

## Content outline

1. **Opening:** AWS provides powerful primitives, but each project repeatedly reconstructs operational decisions around infrastructure.
2. **The problem:** boilerplate, inconsistent observability, under-specified IAM, compliance drift, and AI-generated infrastructure that needs guardrails.
3. **What pawl is:** a TypeScript monorepo containing opinionated AWS CDK constructs, Lambda handler wrappers, and an AI-powered infrastructure CLI.
4. **Core principles:** useful opinions, batteries included, type and runtime safety, composability rather than hiding AWS, and local/integration-testable infrastructure.
5. **Package tour:**
   - `@pawl/cdk`: constructs, tags, IAM, alarms, cdk-nag-oriented compliance, durable Lambda support, and CodeCommit/CodePipeline workflows.
   - `@pawl/lambda`: typed event handlers with AWS Lambda Powertools and durable execution support.
   - `@pawl/cli`: project scaffolding, CodeCommit/CodePipeline initialization, and Bedrock-backed infrastructure assistance.
6. **Concrete example:** the CodeCommit auto-reviewer, showing EventBridge → router Lambda → durable reviewer Lambda, with DynamoDB, CodeBuild, Bedrock, and CodeCommit integrations.
7. **What pawl is and is not:** an opinionated foundation that keeps AWS visible and composable; not a replacement for AWS, CDK, or application-specific design decisions.
8. **Closing:** the intended outcome is reducing repeated plumbing so teams can spend more time designing services.

## Technical examples

Include concise TypeScript examples grounded in the repository, such as:

- Importing `LambdaFunction`/`ApiGateway` from `@pawl/cdk`.
- Creating a Powertools-backed handler with `useApiHandler` from `@pawl/lambda`.
- Configuring `CodeCommit` with `autoReview` to demonstrate the higher-level workflow.

Before drafting examples, verify each API against the current exports and source files (`packages/cdk/index.ts`, `packages/cdk/src/codecommit.ts`, `packages/cdk/src/codecommit-auto-reviewer.ts`, `packages/cdk/src/codepipeline.ts`, `packages/cdk/src/durable-lambda-function.ts`, `packages/lambda/index.ts`, and the relevant handler files). Verify the package boundaries, CLI capabilities, and CodeCommit auto-reviewer flow against `README.md`, `packages/cli/index.ts`, and the current source before making claims. Keep examples illustrative and avoid implying that every construct has identical behavior.

Include one Mermaid architecture diagram. Draw the pawl packages as the developer-facing layer and AWS resources as the runtime/deployment layer; show only the relationships supported by the repository. In particular, do not imply that `@pawl/lambda` directly creates AWS resources or that every package participates in the CodeCommit auto-reviewer.

## Accuracy constraints

- Use the current package names and exported capabilities in the repository.
- Describe pawl as a TypeScript monorepo targeting Node.js 22+, with Bun used for repository tooling/package management/testing; do not describe Bun as the Lambda runtime. Mention AWS CDK, Zod, and Powertools where relevant.
- Do not claim pawl eliminates all infrastructure decisions, guarantees compliance, or replaces AWS expertise.
- Distinguish `@pawl/cli` from the reusable libraries.
- Mention the CodeCommit auto-reviewer and durable Lambda support as concrete current capabilities, not as the only purpose of pawl.
- Preserve a practical, non-marketing explanation of trade-offs.

## Length and detail budget

Target approximately 1,500–2,200 words. Include no more than three short TypeScript examples and one Mermaid diagram so the post remains a blog article rather than becoming package documentation.

## Deliverable

A Markdown file under `/Users/jolo/Documents/Obsidian Vault/Blogs/` with a clear title, headings, code fences, and the architecture diagram.
