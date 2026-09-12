---
editUrl: false
next: false
prev: false
title: "StaticSitePropsSchema"
---

> `const` **StaticSitePropsSchema**: `ZodObject`\<\{ `cognito`: `ZodOptional`\<`ZodObject`\<\{ `userPool`: `ZodCustom`\<`IUserPool`, `IUserPool`\>; `userPoolClient`: `ZodCustom`\<`IUserPoolClient`, `IUserPoolClient`\>; \}, `$strip`\>\>; `indexDocument`: `ZodDefault`\<`ZodString`\>; \}, `$strip`\>

Defined in: [packages/cdk/src/static-site.ts:45](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/static-site.ts#L45)

Runtime-validated configuration accepted by [StaticSite](/cdk/classes/staticsite/).
