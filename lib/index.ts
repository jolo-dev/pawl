// import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface HemsLibProps {
  // Define construct properties here
}

export class HemsLib extends Construct {

  constructor(scope: Construct, id: string, props: HemsLibProps = {}) {
    super(scope, id);

    // Define construct contents here

    // example resource
    // const queue = new sqs.Queue(this, 'HemsLibQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
