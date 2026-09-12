---
editUrl: false
next: false
prev: false
title: "ReviewCoordinationDeploymentSchema"
---

> `const` **ReviewCoordinationDeploymentSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `phase`: `ZodLiteral`\<`"prepareGsi1"`\>; \}, `$strict`\>, `ZodObject`\<\{ `phase`: `ZodLiteral`\<`"prepareGsi2"`\>; \}, `$strict`\>, `ZodObject`\<\{ `phase`: `ZodLiteral`\<`"active"`\>; `reviewActionTimeoutMinutes`: `ZodDefault`\<`ZodNumber`\>; \}, `$strict`\>\], `"phase"`\>

Defined in: [packages/cdk/src/review-coordination-deployment.ts:50](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/review-coordination-deployment.ts#L50)

State-table preparation and runtime activation for review coordination.

Preparation phases intentionally cannot carry runtime configuration. Only
the active phase creates the bridge and reconciler runtime resources.
