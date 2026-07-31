export interface DynamoDbConditionalCheckFailedError {
	readonly name: "ConditionalCheckFailedException";
}

export const isDynamoDbConditionalCheckFailedError = (
	error: unknown,
): error is DynamoDbConditionalCheckFailedError =>
	typeof error === "object" &&
	error !== null &&
	"name" in error &&
	error.name === "ConditionalCheckFailedException";
