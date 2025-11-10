import { Construct } from "constructs";
import {
  EventBridge,
  ApiGateway,
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
  LambdaFunction,
  Stack,
} from "@pawl/cdk";

export class GridxEvStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // First ApiGateway as our Event receiver with authorizer
    // The authorizer lambda verifies and validates the incoming request
    const authHandler = new LambdaFunction(this, "verifier-and-validator", {
      entry: "src/verifier-and-validator.ts",
    });

    const authorizer = new HttpLambdaAuthorizer("event-receiver-authorizer", authHandler.lambda, {
      responseTypes: [HttpLambdaResponseType.SIMPLE], // Define if returns simple and/or iam response
    });

    const target = new EventBridge(this, "event-bridge", {
      eventBusName: "gridx-ev-bus",
      targets: [
        // Add targets here as needed
      ],
    });

    new ApiGateway(this, "event-receiver", {
      authorizer,
      routes: {
        "POST /webhook": target,
      },
    });
  }
}
