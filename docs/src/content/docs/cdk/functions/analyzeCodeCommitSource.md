---
editUrl: false
next: false
prev: false
title: "analyzeCodeCommitSource"
---

> **analyzeCodeCommitSource**(`options`): [`CodeCommitSourceAnalysis`](/cdk/interfaces/codecommitsourceanalysis/)

Defined in: [packages/cdk/src/codecommit-source.ts:317](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-source.ts#L317)

Analyze a local source directory for CodeCommit initial seeding.

Applies the following ignore precedence:
1. Root `.gitignore` patterns from the source path.
2. Forced inclusion of `forceIncludePath` (when supplied) via negation patterns.
3. Discovered symlink paths (as literal excludes so CDK packaging omits them).
4. The immutable [CODECOMMIT\_SECURITY\_EXCLUDES](/cdk/variables/codecommit_security_excludes/) denylist, applied last.

Validates that the source is a real directory, never follows symlinks, and
enforces all [CODECOMMIT\_SOURCE\_LIMITS](/cdk/variables/codecommit_source_limits/) before returning.

## Parameters

### options

[`AnalyzeCodeCommitSourceOptions`](/cdk/interfaces/analyzecodecommitsourceoptions/)

The source path and optional forced infrastructure child.

## Returns

[`CodeCommitSourceAnalysis`](/cdk/interfaces/codecommitsourceanalysis/)

The filtered file set, ordered asset excludes, and total byte count.

## Throws

when any limit is exceeded.

## Throws

when the source path is not a real directory.
