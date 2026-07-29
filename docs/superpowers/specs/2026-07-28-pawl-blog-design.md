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
   - `@pawl/cdk`: constructs, tags, IAM, alarms, cdk-nag-oriented compliance, and durable Lambda support.
   - `@pawl/lambda`: typed event handlers with AWS Lambda Powertools and durable execution support.
   - `@pawl/cli`: project scaffolding and Bedrock-backed infrastructure assistance.
6. **Concrete example:** a small Lambda-backed service, showing how a CDK construct and a typed handler fit together without hiding AWS concepts.
7. **Series boundary:** briefly name CodeCommit and CodePipeline automation as follow-up use cases; defer their detailed workflows and auto-reviewer architecture to separate posts.
8. **What pawl is and is not:** an opinionated foundation that keeps AWS visible and composable; not a replacement for AWS, CDK, or application-specific design decisions.
9. **Closing:** the intended outcome is reducing repeated plumbing so teams can spend more time designing services.

## Technical examples

Include concise examples grounded in the repository:

- A TypeScript CDK example importing `LambdaFunction`/`ApiGateway` from `@pawl/cdk`.
- A TypeScript Lambda example creating a Powertools-backed handler with `useApiHandler` from `@pawl/lambda`.
- A short shell example showing `pawl init` as a preview of the CLI surface; do not include CodeCommit or CodePipeline implementation details in this post.

Before drafting examples, verify each API against the current exports and source files (`packages/cdk/index.ts`, `packages/cdk/src/apigateway.ts`, `packages/cdk/src/lambda-function.ts`, `packages/lambda/index.ts`, `packages/lambda/src/api-handler.ts`, and `packages/cli/index.ts`). Verify package boundaries and the CLI capabilities against `README.md`, package metadata, and the current source before making claims. Keep examples illustrative and avoid implying that every construct has identical behavior.

Include one Mermaid architecture diagram. Draw the pawl packages as the developer-facing layer and AWS resources as the runtime/deployment layer; show only the relationships supported by the repository. Do not imply that `@pawl/lambda` directly creates AWS resources. Label CodeCommit and CodePipeline as future use-case topics rather than expanding their runtime architecture here.

## Accuracy constraints

- Use the current package names and exported capabilities in the repository.
- Describe pawl as a TypeScript monorepo targeting Node.js 22+, with Bun used for repository tooling/package management/testing; do not describe Bun as the Lambda runtime. Mention AWS CDK, Zod, and Powertools where relevant.
- Do not claim pawl eliminates all infrastructure decisions, guarantees compliance, or replaces AWS expertise.
- Distinguish `@pawl/cli` from the reusable libraries.
- Mention durable Lambda support as a concrete current capability, and mention CodeCommit/CodePipeline support only as subjects for separate use-case posts.
- Preserve a practical, non-marketing explanation of trade-offs.

## Length and detail budget

Target approximately 1,500–2,200 words. Include no more than two short TypeScript examples, one short CLI shell example, and one Mermaid diagram so the post remains a blog article rather than becoming package documentation.

## Deliverable

A Markdown file under `/Users/jolo/Documents/Obsidian Vault/Blogs/` with a clear title, headings, code fences, and the architecture diagram.
