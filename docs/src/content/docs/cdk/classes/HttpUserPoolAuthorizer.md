---
editUrl: false
next: false
prev: false
title: "HttpUserPoolAuthorizer"
---

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:33

Authorize Http Api routes on whether the requester is registered as part of
an AWS Cognito user pool.

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpUserPoolAuthorizer()

> **new HttpUserPoolAuthorizer**(`id`, `pool`, `props`?): [`HttpUserPoolAuthorizer`](/cdk/classes/httpuserpoolauthorizer/)

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:48

Initialize a Cognito user pool authorizer to be bound with HTTP route.

#### Parameters

##### id

`string`

The id of the underlying construct

##### pool

`IUserPool`

The user pool to use for authorization

##### props?

`HttpUserPoolAuthorizerProps`

Properties to configure the authorizer

#### Returns

[`HttpUserPoolAuthorizer`](/cdk/classes/httpuserpoolauthorizer/)

## Properties

### authorizationType

> `readonly` **authorizationType**: `"JWT"` = `"JWT"`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:41

The authorizationType used for UserPool Authorizer

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:52

Return the id of the authorizer if it's been constructed

##### Returns

`string`

## Methods

### bind()

> **bind**(`options`): `HttpRouteAuthorizerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:53

Bind this authorizer to a specified Http route.

#### Parameters

##### options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`
