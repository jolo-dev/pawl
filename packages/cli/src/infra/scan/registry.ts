/**
 * The scanner set pawl ships.
 *
 * Bounded deliberately: pawl's constructs centre on a small service set, and the
 * coverage reporting exists precisely so a missing service shows up as a gap
 * instead of a wrong answer. Add a scanner when a real scan reports a gap, not
 * because a service exists.
 *
 * Note for the eve build: importing this module pulls in every AWS client it
 * references, so it is the heaviest import in the authored graph. Keep it behind
 * the `scan_resources` tool and measure `eve build` size when adding services.
 */

import { scanApiGateway, scanApiGatewayV1 } from "./apigateway";
import { scanDynamoDb } from "./dynamodb";
import { scanEventBridge } from "./eventbridge";
import { scanLambda } from "./lambda";
import { scanS3 } from "./s3";
import { scanSqs } from "./sqs";
import type { ResourceScanner, ScanContext, ScannerFactory } from "./types";

/** v1 coverage. Order is report order. */
export const PAWL_SCANNER_FACTORIES: readonly ScannerFactory[] = [
	scanLambda,
	scanApiGateway,
	scanApiGatewayV1,
	scanDynamoDb,
	scanSqs,
	scanS3,
	scanEventBridge,
];

/** Services v1 does not read, named so coverage can say so rather than omit them. */
export const DEFERRED_SERVICES: readonly string[] = [
	"sns",
	"codebuild",
	"codecommit",
	"codepipeline",
	"cognito",
	"cloudfront",
	"cloudwatch-logs",
	"iam",
	"kms",
	"ec2",
	"appsync",
	"agentcore",
];

export function buildScanners(context: ScanContext): ResourceScanner[] {
	return PAWL_SCANNER_FACTORIES.map((factory) => factory(context));
}
