---
editUrl: false
next: false
prev: false
title: "DirectFoundationModelIdSchema"
---

> `const` **DirectFoundationModelIdSchema**: `ZodString`

Defined in: [packages/cdk/src/codecommit-auto-reviewer.ts:54](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-auto-reviewer.ts#L54)

Direct Bedrock foundation-model ID without a routing prefix.

Provider and model segments remain provider-agnostic. The exact grammar
prevents unsafe fragments from being interpolated into Bedrock IAM ARNs.
