import { defineAgent } from "eve";
import { pawlModelConfig } from "./lib/bedrock";

/**
 * AWS clients the scanners use, kept out of the authored bundle.
 *
 * Bundling them inlined seven SDK clients into the entry chunk and grew it from
 * 4.4 MB to 12.1 MB. They are ordinary dependencies, so eve can trace them into
 * the hosted output instead of bundling them.
 */
const EXTERNAL_AWS_DEPENDENCIES = [
	"@aws-sdk/client-api-gateway",
	"@aws-sdk/client-apigatewayv2",
	"@aws-sdk/client-dynamodb",
	"@aws-sdk/client-eventbridge",
	"@aws-sdk/client-lambda",
	"@aws-sdk/client-s3",
	"@aws-sdk/client-sqs",
	"@aws-sdk/client-sts",
	"@aws-sdk/credential-providers",
];

/**
 * pawl runs on AWS Bedrock through a direct AI SDK provider instance rather
 * than an AI Gateway model id. See `lib/bedrock.ts` for the credential wiring,
 * the reasoning configuration, and the context-window resolution.
 */
export default defineAgent({
	...pawlModelConfig(),
	build: { externalDependencies: EXTERNAL_AWS_DEPENDENCIES },
});
