---
editUrl: false
next: false
prev: false
title: "HttpIamAuthorizer"
---

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

The authorizationType used for IAM Authorizer

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/iam.d.ts:9

## Methods

### bind()

> **bind**(`_options`): `HttpRouteAuthorizerConfig`

Bind this authorizer to a specified Http route.

#### Parameters

##### \_options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/iam.d.ts:10
