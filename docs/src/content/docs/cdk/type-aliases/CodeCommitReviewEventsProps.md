---
editUrl: false
next: false
prev: false
title: "CodeCommitReviewEventsProps"
---

> **CodeCommitReviewEventsProps** = [`RepositoryTarget`](/cdk/type-aliases/repositorytarget/) & `z.input`\<*typeof* [`CodeCommitReviewEventsConfigSchema`](/cdk/variables/codecommitrevieweventsconfigschema/)\> & `BasicConstructProps` & `object`

Defined in: [packages/cdk/src/codecommit-review-events.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-review-events.ts#L37)

Properties for CodeCommit review-event routing.

## Type Declaration

### router

> **router**: [`LambdaFunction`](/cdk/classes/lambdafunction/)

Pawl Lambda that receives the complete EventBridge event.
