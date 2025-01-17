---
editUrl: false
next: false
prev: false
title: "AttributeType"
---

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:88

Data types for attributes within a table

## See

https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html#HowItWorks.DataTypes

## Enumeration Members

### BINARY

> **BINARY**: `"B"`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:92

Up to 400KiB of binary data (which must be encoded as base64 before sending to DynamoDB)

***

### NUMBER

> **NUMBER**: `"N"`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:96

Numeric values made of up to 38 digits (positive, negative or zero)

***

### STRING

> **STRING**: `"S"`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:100

Up to 400KiB of UTF-8 encoded text
