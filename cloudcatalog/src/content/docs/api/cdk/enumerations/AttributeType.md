---
editUrl: false
next: false
prev: false
title: "AttributeType"
---

Data types for attributes within a table

## See

https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html#HowItWorks.DataTypes

## Enumeration Members

### BINARY

> **BINARY**: `"B"`

Up to 400KiB of binary data (which must be encoded as base64 before sending to DynamoDB)

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:92

***

### NUMBER

> **NUMBER**: `"N"`

Numeric values made of up to 38 digits (positive, negative or zero)

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:96

***

### STRING

> **STRING**: `"S"`

Up to 400KiB of UTF-8 encoded text

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/shared.d.ts:100
