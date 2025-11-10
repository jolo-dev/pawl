// import {
//   ApiGateway,
//   type Construct,
//   HttpJwtAuthorizer,
//   HttpUserPoolAuthorizer,
//   LambdaFunction,
//   Stack,
//   UserPool,
// } from "@pawl/cdk";
// import { lambdaSrc } from "../src/utils";

// export class CognitoAuthorizerStack extends Stack {
//   constructor(scope: Construct, id: string) {
//     super(scope, id);

//     const userPool = new UserPool(this, "UserPool", {
//       signInAliases: { email: true },
//     });
//     // const authorizer = new HttpUserPoolAuthorizer("TestAuthorizer", userPool); --> use the Cognito SDK: https://www.npmjs.com/package/amazon-cognito-identity-js

//     // Create an App Client
//     const appClient = userPool.addClient("MyAppClient", {
//       authFlows: {
//         userPassword: true,
//       },
//     });
//     const jwtAuthorizer = new HttpJwtAuthorizer(
//       "JwtAuthorizer",
//       `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
//       {
//         jwtAudience: [appClient.userPoolClientId],
//         identitySource: ["$request.header.Authorization"],
//       },
//     );

//     new ApiGateway(this, "Foo", {
//       routes: {
//         "GET /bla": new LambdaFunction(this, "CognitoTest", {
//           entry: lambdaSrc("authorizer-handler"),
//         }),
//         "GET /test": new LambdaFunction(this, "AnotherTest", {
//           entry: lambdaSrc("api-test-handler"),
//         }),
//       },
//       authorizer: jwtAuthorizer,
//     });
//   }
// }
