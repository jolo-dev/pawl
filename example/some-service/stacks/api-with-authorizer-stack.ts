import {
  ApiGateway,
  type Construct,
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
  LambdaFunction,
  Stack,
} from "@hems-lib/cdk";
import { lambdaSrc } from "../src/utils";

export class ApiWithAuthorizerStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const authHandler = new LambdaFunction(this, "AuthHandler", {
      entry: lambdaSrc("authorizer-handler"),
    });

    const authorizer = new HttpLambdaAuthorizer("BooksAuthorizer", authHandler.lambda, {
      responseTypes: [HttpLambdaResponseType.SIMPLE], // Define if returns simple and/or iam response
    });

    new ApiGateway(this, "ApiGateway", {
      routes: {
        "GET /test": new LambdaFunction(this, "TestFunction", {
          entry: lambdaSrc("api-test-handler"),
        }),
        "POST /foo": new LambdaFunction(this, "AnotherTestFunction", {
          entry: lambdaSrc("api-test-handler"),
          authorizer: false,
        }),
      },
      authorizer,
    });
  }
}
