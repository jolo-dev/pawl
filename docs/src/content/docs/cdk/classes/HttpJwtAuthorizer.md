---
editUrl: false
next: false
prev: false
title: "HttpJwtAuthorizer"
---

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:27

Authorize Http Api routes on whether the requester is registered as part of
an AWS Cognito user pool.

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpJwtAuthorizer()

> **new HttpJwtAuthorizer**(`id`, `jwtIssuer`, `props`): [`HttpJwtAuthorizer`](/cdk/classes/httpjwtauthorizer/)

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:42

Initialize a JWT authorizer to be bound with HTTP route.

#### Parameters

##### id

`string`

The id of the underlying construct

##### jwtIssuer

`string`

The base domain of the identity provider that issues JWT

##### props

`HttpJwtAuthorizerProps`

Properties to configure the authorizer

#### Returns

[`HttpJwtAuthorizer`](/cdk/classes/httpjwtauthorizer/)

## Properties

### authorizationType

> `readonly` **authorizationType**: `"JWT"` = `"JWT"`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:35

The authorizationType used for JWT Authorizer

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:46

Return the id of the authorizer if it's been constructed

##### Returns

`string`

## Methods

### bind()

> **bind**(`options`): `HttpRouteAuthorizerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:47

Bind this authorizer to a specified Http route.

#### Parameters

##### options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`
