---
editUrl: false
next: false
prev: false
title: "EventBridgeProps"
---

> **EventBridgeProps** = `object` & `Omit`\<`EventBusProps`, `"eventBusName"` \| `"deadLetterQueue"`\> & `BasicConstructProps`

Defined in: [packages/cdk/src/eventbridge.ts:36](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/eventbridge.ts#L36)

## Type Declaration

### eventBusName

> **eventBusName**: `string`

### secrets?

> `optional` **secrets?**: [`EventTarget`](/cdk/interfaces/eventtarget/) *extends* [`ApiDestination`](/cdk/classes/apidestination/) ? [`SecretValue`](/cdk/classes/secretvalue/) : `undefined`

### targets

> **targets**: [`EventTarget`](/cdk/interfaces/eventtarget/)[]
