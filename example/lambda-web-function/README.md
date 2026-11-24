# lambda-web-function

A bundled Node.js HTTP server deployed with `@pawl/cdk`'s `WebFunction`.

## Construct configuration

```ts
import {
  WebFunction,
  WebFunctionAuthType,
  WebFunctionEndpointType,
} from "@pawl/cdk";

new WebFunction(stack, "WebFunction", {
  entry: "src/http.ts",
  functionName: "my-web-function",
  authType: WebFunctionAuthType.APPLICATION_MANAGED,
  endpointType: WebFunctionEndpointType.HOME_REGION,
  endpointName: "prod",
  timeoutSeconds: 30,
  environmentVariables: { STAGE: "prod" },
});
```

The five entry/name/authentication/endpoint properties are required. Other options
include `description`, `regions`, `scalingConfig`, `throttleConfig`,
`maxConcurrencyPerEnvironment`, `timeoutSeconds`, `environmentVariables`,
`loggingConfig`, and `cognito`. Invalid configuration fails during construction.
Authentication and endpoint types must use the exported option objects rather than
raw strings. `IAM_AUTH`, `MULTI_REGION`, and `PER_REGION` are also available.

The entry is bundled into a single Node.js JavaScript file using Bun and packaged
with `zip`; both commands must be installed on the synthesis host. The construct
creates a private versioned code bucket, revision execution role, immutable
revision, and endpoint routing all traffic to that revision. It preserves pawl
permissions and endpoint monitoring.

Optional `cognito: { domainPrefix, callbackUrls, logoutUrls? }` creates a retained
user pool, public authorization-code app client, and managed login domain. It
requires `APPLICATION_MANAGED`, accepts HTTPS redirects (HTTP only for loopback),
and injects `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`; those variables cannot
be overridden. Logout URLs default to callback URLs. Browser clients must use
PKCE. **Cognito provisioning does not protect the endpoint automatically: the
application must verify tokens on every protected request.** The generated login
domain and IDs are exposed as stack outputs.

## Package manager

- bun

## AWS

- Profile: `jolo`

## Testing

localstack

## LocalStack

This scaffold includes a local development entrypoint and LocalStack helper scripts.

Start developing with `bun run dev` / `pnpm run dev` / `npm run dev`.

## Quick start

```bash
bun run dev
```
