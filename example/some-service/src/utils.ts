import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const __dirname = fileURLToPath(new URL(".", import.meta.url));

export function lambdaSrc(lambdaName: string) {
	return path.join(__dirname, `../src/${lambdaName}.ts`);
}

export function throwError(message: string): never {
	throw new Error(message);
}
