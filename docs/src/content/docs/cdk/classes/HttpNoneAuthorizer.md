---
editUrl: false
next: false
prev: false
title: "HttpNoneAuthorizer"
---

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2/lib/http/authorizer.d.ts:192

Explicitly configure no authorizers on specific HTTP API routes.

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### Constructor

> **new HttpNoneAuthorizer**(): `HttpNoneAuthorizer`

#### Returns

`HttpNoneAuthorizer`

## Properties

### authorizationType

> `readonly` **authorizationType**: `"NONE"` = `"NONE"`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2/lib/http/authorizer.d.ts:196

The authorizationType used for IAM Authorizer

## Methods

### bind()

> **bind**(`_options`): `HttpRouteAuthorizerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2/lib/http/authorizer.d.ts:197

Bind this authorizer to a specified Http route.

#### Parameters

##### \_options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`
