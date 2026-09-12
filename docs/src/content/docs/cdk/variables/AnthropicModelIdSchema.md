---
editUrl: false
next: false
prev: false
title: "AnthropicModelIdSchema"
---

> `const` **AnthropicModelIdSchema**: `ZodUnion`\<readonly \[`ZodString`, `ZodString`\]\>

Defined in: [packages/cdk/src/codecommit.ts:43](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L43)

Zod schema validating either a direct Anthropic foundation-model ID or an
Anthropic AWS system-defined cross-region inference profile ID for the
high-level `CodeCommit` and CLI contract.

This intentionally remains Anthropic-specific while refining the safe,
provider-agnostic contract used directly by `CodeCommitAutoReviewer`.
