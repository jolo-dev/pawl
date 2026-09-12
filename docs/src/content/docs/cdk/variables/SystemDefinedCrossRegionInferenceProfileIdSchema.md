---
editUrl: false
next: false
prev: false
title: "SystemDefinedCrossRegionInferenceProfileIdSchema"
---

> `const` **SystemDefinedCrossRegionInferenceProfileIdSchema**: `ZodString`

Defined in: [packages/cdk/src/codecommit-auto-reviewer.ts:70](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-auto-reviewer.ts#L70)

AWS system-defined cross-region inference profile ID.

The routing prefix is restricted to AWS-supported scopes, while provider and
model segments remain provider-agnostic. The exact grammar prevents unsafe
fragments from being interpolated into Bedrock IAM resource ARNs.
