---
editUrl: false
next: false
prev: false
title: "AgentCoreProps"
---

> **AgentCoreProps** = `object` & `Omit`\<`RuntimeProps`, `"agentRuntimeArtifact"` \| `"protocolConfiguration"`\> & `BasicConstructProps`

Defined in: [packages/cdk/src/agentcore.ts:24](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/agentcore.ts#L24)

## Type Declaration

### assetPath?

> `optional` **assetPath?**: `string`

Directory containing the built Node.js AgentCore application.

### endpoint?

> `optional` **endpoint?**: `object`

#### endpoint.description?

> `optional` **description?**: `string`

#### endpoint.name?

> `optional` **name?**: `string`
