---
editUrl: false
next: false
prev: false
title: "EventBridgeProps"
---

> **EventBridgeProps**: `object` & `Omit`\<`EventBusProps`, `"eventBusName"` \| `"deadLetterQueue"`\> & `BasicConstructProps`

Defined in: packages/cdk/src/eventbridge.ts:26

## Type declaration

### eventBusName

> **eventBusName**: `string`

### secrets?

> `optional` **secrets**: [`EventTarget`](/cdk/interfaces/eventtarget/) *extends* [`ApiDestination`](/cdk/classes/apidestination/) ? [`SecretValue`](/cdk/classes/secretvalue/) : `undefined`

### targets

> **targets**: [`EventTarget`](/cdk/interfaces/eventtarget/)[]
