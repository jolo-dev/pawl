import { type Construct, LambdaFunction, Stack } from "@pawl/cdk";
import { lambdaSrc } from "../src/utils";

export class SimpleLambdaStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LambdaFunction(this, "foo", {
      entry: lambdaSrc("api-test-handler"),
    });
  }
}
