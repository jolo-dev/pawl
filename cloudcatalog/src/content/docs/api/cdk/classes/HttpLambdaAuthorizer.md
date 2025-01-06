---
editUrl: false
next: false
prev: false
title: "HttpLambdaAuthorizer"
---

Authorize Http Api routes via a lambda function

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpLambdaAuthorizer()

> **new HttpLambdaAuthorizer**(`id`, `handler`, `props`?): [`HttpLambdaAuthorizer`](/public/api/cdk/classes/httplambdaauthorizer/)

Initialize a lambda authorizer to be bound with HTTP route.

#### Parameters

##### id

`string`

The id of the underlying construct

##### handler

`IFunction`

##### props?

`HttpLambdaAuthorizerProps`

Properties to configure the authorizer

#### Returns

[`HttpLambdaAuthorizer`](/public/api/cdk/classes/httplambdaauthorizer/)

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:66

## Properties

### authorizationType

> `readonly` **authorizationType**: `"CUSTOM"` = `"CUSTOM"`

The authorizationType used for Lambda Authorizer

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:59

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Return the id of the authorizer if it's been constructed

##### Returns

`string`

#### Defined in

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:70

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

node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:71
