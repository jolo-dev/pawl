---
editUrl: false
next: false
prev: false
title: "HttpLambdaAuthorizer"
---

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:50

Authorize Http Api routes via a lambda function

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### new HttpLambdaAuthorizer()

> **new HttpLambdaAuthorizer**(`id`, `handler`, `props`?): [`HttpLambdaAuthorizer`](/cdk/classes/httplambdaauthorizer/)

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:66

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

[`HttpLambdaAuthorizer`](/cdk/classes/httplambdaauthorizer/)

## Properties

### authorizationType

> `readonly` **authorizationType**: `"CUSTOM"` = `"CUSTOM"`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:59

The authorizationType used for Lambda Authorizer

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:70

Return the id of the authorizer if it's been constructed

##### Returns

`string`

## Methods

### bind()

> **bind**(`options`): `HttpRouteAuthorizerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:71

Bind this authorizer to a specified Http route.

#### Parameters

##### options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`
