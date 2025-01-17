---
editUrl: false
next: false
prev: false
title: "HttpIamAuthorizer"
---

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/iam.d.ts:5

Authorize HTTP API Routes with IAM

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpIamAuthorizer()

> **new HttpIamAuthorizer**(): [`HttpIamAuthorizer`](/cdk/classes/httpiamauthorizer/)

#### Returns

[`HttpIamAuthorizer`](/cdk/classes/httpiamauthorizer/)

## Properties

### authorizationType

> `readonly` **authorizationType**: `IAM` = `HttpAuthorizerType.IAM`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/iam.d.ts:9

The authorizationType used for IAM Authorizer

## Methods

### bind()

> **bind**(`_options`): `HttpRouteAuthorizerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/iam.d.ts:10

Bind this authorizer to a specified Http route.

#### Parameters

##### \_options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`
