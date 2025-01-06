---
editUrl: false
next: false
prev: false
title: "HttpJwtAuthorizer"
---

Authorize Http Api routes on whether the requester is registered as part of
an AWS Cognito user pool.

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpJwtAuthorizer()

> **new HttpJwtAuthorizer**(`id`, `jwtIssuer`, `props`): [`HttpJwtAuthorizer`](/public/api/cdk/classes/httpjwtauthorizer/)

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

[`HttpJwtAuthorizer`](/public/api/cdk/classes/httpjwtauthorizer/)

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:42

## Properties

### authorizationType

> `readonly` **authorizationType**: `"JWT"` = `"JWT"`

The authorizationType used for JWT Authorizer

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:35

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Return the id of the authorizer if it's been constructed

##### Returns

`string`

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:46

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

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/jwt.d.ts:47
