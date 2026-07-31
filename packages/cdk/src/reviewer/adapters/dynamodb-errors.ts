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

export interface DynamoDbPureConditionalTransactionCanceledError {
	readonly name: "TransactionCanceledException";
	readonly CancellationReasons: readonly Readonly<{ Code: string }>[];
}

export const isDynamoDbPureConditionalTransactionCanceledError = (
	error: unknown,
): error is DynamoDbPureConditionalTransactionCanceledError => {
	if (
		typeof error !== "object" ||
		error === null ||
		!("name" in error) ||
		error.name !== "TransactionCanceledException" ||
		!("CancellationReasons" in error) ||
		!Array.isArray(error.CancellationReasons)
	) {
		return false;
	}
	const codes = error.CancellationReasons.map((reason: unknown) =>
		typeof reason === "object" && reason !== null && "Code" in reason
			? reason.Code
			: undefined,
	);
	return (
		codes.includes("ConditionalCheckFailed") &&
		codes.every((code) => code === "None" || code === "ConditionalCheckFailed")
	);
};
