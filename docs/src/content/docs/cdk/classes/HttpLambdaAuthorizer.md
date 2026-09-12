---
editUrl: false
next: false
prev: false
title: "HttpLambdaAuthorizer"
---

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:59

Authorize Http Api routes via a lambda function

## Implements

- `IHttpRouteAuthorizer`

## Constructors

### Constructor

> **new HttpLambdaAuthorizer**(`id`, `handler`, `props?`): `HttpLambdaAuthorizer`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:75

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

`HttpLambdaAuthorizer`

## Properties

### authorizationType

> `readonly` **authorizationType**: `"CUSTOM"` = `"CUSTOM"`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:68

The authorizationType used for Lambda Authorizer

## Accessors

### authorizerId

#### Get Signature

> **get** **authorizerId**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:79

Return the id of the authorizer if it's been constructed

##### Returns

`string`

## Methods

### bind()

> **bind**(`options`): `HttpRouteAuthorizerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-apigatewayv2-authorizers/lib/http/lambda.d.ts:80

Bind this authorizer to a specified Http route.

#### Parameters

##### options

`HttpRouteAuthorizerBindOptions`

#### Returns

`HttpRouteAuthorizerConfig`

#### Implementation of

`IHttpRouteAuthorizer.bind`
