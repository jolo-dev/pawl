<a name="readme-top"></a>
<div align="center">

# @hems-aws/cdk

An internal FEH IT package which contains best practices and a small library for using CDK in your next project.

</div>

 <details>
<summary>Table of Contents</summary>

- [@hem-lib/cdk](#hem-libcdk)
  - [ℹ️ About the Project](#-about-the-project)
  - [❓ Why](#-why)
  - [⚙ ️Setup](#-setup)
    - [Pre-requisite](#pre-requisite)
    - [Installation](#installation)
    - [Context](#context)
  - [Troubleshooting](#troubleshooting)

</details>

## ℹ️ About the Project

This is an internal package which contains constructs and helper methods to create your infrastructure with CDK. It contains all the necessary organisational requirements.
This should be the only package to put as dependency and no need to require the `aws-cdk-lib`, `aws-cdk` or `constructs`.

## ❓ Why

- Best practices for the FEH IT at E.ON.
- Abstract AWS CDK away by providing **"building blocks"**
  - Using the right AWS resources
  - Providing pre-defined Constructs
  - Just trust your IDE
- Organisational-wide accepted
  - Includes Tags
  - Contains the right permissions

## ⚙ ️Setup

### Pre-requisite

- Docker
- (For deploying) [aws configure sso](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
  - `aws sso login --profile my-profile`

### Installation

- `npm install`

> For Local Development: All the following commands required to deploy the stack at least once to Localstack `npm run deploy:local`

### Context

Each stack has to [set context](https://docs.aws.amazon.com/cdk/v2/guide/get_context_var.html).
The context is needed for the [tags](./src/basic-tags.ts) and other resource/imports.

- via `cdk.context.json`
- via a `context`- block in `cdk.json`
- via in your Stack directly `this.setContext("key", "value")`
- via CLI `npx cdk -c key=value`

## 🐬 Local deployment

You can deploy it locally against [Localstack](https://docs.localstack.cloud/overview/) in order to validate your CDK-stack.

You need to bootstrap and deploy first:

```sh
npm run deploy:local
```

### Dev Mode

You need to adjust your [`local.dev.ts`](local.dev.ts) and define the folder of your Lambdas. The `@hems-lib/cdk` comes with a `Local` method.
All the [requirements](#pre-requisite) should be meet.

```sh
npm run dev
```

## Troubleshooting

It could happen that redeploying fails.
Try to remove the stack `npm run remove:local` and then redeploy `npm run deploy:local`.

<p align="right"><a href="#readme-top">(Back to top)</a></p>

