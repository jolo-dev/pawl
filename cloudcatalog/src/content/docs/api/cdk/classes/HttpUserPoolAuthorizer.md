---
editUrl: false
next: false
prev: false
title: "HttpUserPoolAuthorizer"
---

Authorize Http Api routes on whether the requester is registered as part of
an AWS Cognito user pool.

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpUserPoolAuthorizer()

> **new HttpUserPoolAuthorizer**(`id`, `pool`, `props`?): [`HttpUserPoolAuthorizer`](/api/cdk/classes/httpuserpoolauthorizer/)

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

[`HttpUserPoolAuthorizer`](/api/cdk/classes/httpuserpoolauthorizer/)

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:48

## Properties

### authorizationType

> `readonly` **authorizationType**: `"JWT"` = `"JWT"`

The authorizationType used for UserPool Authorizer

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:41

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Return the id of the authorizer if it's been constructed

##### Returns

`string`

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:52

## Methods

### bind()

> **bind**(`options`): `HttpRouteAuthorizerConfig`

Bind this authorizer to a specified Http route.

#### Parameters

##### options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/user-pool.d.ts:53
