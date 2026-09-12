---
editUrl: false
next: false
prev: false
title: "CodePipelineNamingSchema"
---

> `const` **CodePipelineNamingSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `mode`: `ZodLiteral`\<`"pawl"`\>; \}, `$strict`\>, `ZodObject`\<\{ `mode`: `ZodLiteral`\<`"explicit"`\>; `name`: `ZodString`; \}, `$strict`\>, `ZodObject`\<\{ `coordinationName`: `ZodOptional`\<`ZodString`\>; `mode`: `ZodLiteral`\<`"cloudFormation"`\>; \}, `$strict`\>\], `"mode"`\>

Defined in: [packages/cdk/src/codepipeline.ts:102](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L102)

Physical-name ownership for a CodePipeline.

`pawl` derives the name from the `team` and `stage` CDK context, `explicit`
uses the supplied name, and `cloudFormation` leaves the physical name to
CloudFormation. Active PR-review coordination also requires a stable
`coordinationName` when CloudFormation owns the physical name.
