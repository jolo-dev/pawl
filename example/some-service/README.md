# Device Data Ingestion

This is an example for using the [`@hems-lib/cdk`](../../packages/cdk/) and [`@hems-lib/lambda](../../packages/lambda/).
Thus the name is fictive.

## Local Development

For the local development, [Localstack](https://docs.localstack.cloud/overview/) is used.

### Requirement

- Docker
- `npm install`
- All the following commands required to deploy the stack at least once to Localstack `npm run deploy:local`
- Set Context variables

### Dev Mode

You need to adjust your [`local.dev.ts`](local.dev.ts) and define the folder of your Lambdas. The `@hems-lib/cdk` comes with a `Local` method.
All the [requirements](#requirement) should be meet.

```sh
npm run dev
```

This deploys all your Lambda from the given folder. Lambdas are using [FunctionsURL](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html) which is usually an `ANY` type thus you can use `GET` and `POST`.
The Lambdas are replaced via [CDK hotswap](https://aws.amazon.com/blogs/containers/accelerating-development-feedback-loops-with-aws-cdk-hotswap-deployments-for-amazon-ecs/), meaning changes should be reflected automatically without redeploying. However, this only works with AWS Lambda.