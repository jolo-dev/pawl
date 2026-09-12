---
editUrl: false
next: false
prev: false
title: "CODECOMMIT_SECURITY_EXCLUDES"
---

> `const` **CODECOMMIT\_SECURITY\_EXCLUDES**: readonly \[`"**/.git"`, `"**/.git/**"`, `"**/node_modules/**"`, `"**/cdk.out/**"`, `"**/.cdk.staging/**"`, `"**/.env"`, `"**/.env.*"`, `"**/.aws/credentials"`, `"**/.aws/config"`, `"**/*.pem"`, `"**/*.key"`, `"**/*.p12"`, `"**/*.pfx"`, `"**/id_rsa"`, `"**/id_ed25519"`\]

Defined in: [packages/cdk/src/codecommit-source.ts:50](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-source.ts#L50)

Immutable security denylist applied after user `.gitignore` patterns and
forced infrastructure inclusion.

These patterns cannot be negated by user rules. They exclude nested `.git`
directories/files, `node_modules`, `cdk.out`, `.cdk.staging`, environment
files, AWS credentials, private keys, and certificates at every depth.
