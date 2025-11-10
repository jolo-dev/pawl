// import { ApiGateway, type Construct, LambdaFunction, Stack } from "@pawl/cdk";
// import { lambdaSrc } from "../src/utils";

// export class SimpleApiStack extends Stack {
//   constructor(scope: Construct, id: string) {
//     super(scope, id);

//     new ApiGateway(this, "ApiGateway", {
//       routes: {
//         "GET /foo": new LambdaFunction(this, "FooFunction", {
//           entry: lambdaSrc("api-test-handler"),
//         }),
//       },
//     });
//   }
// }
