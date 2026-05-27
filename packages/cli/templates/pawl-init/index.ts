import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineStacks } from "@pawl/cdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stacksDir = path.join(__dirname, "stacks");

const stacksToDefine = [] as Array<unknown>;

for (const stackDef of fs.readdirSync(stacksDir)) {
	const stack = await import(`${stacksDir}/${stackDef}`);
	for (const key in stack) {
		if (
			typeof stack[key] === "function" &&
			stack[key].prototype.constructor.name !== "Object"
		) {
			stacksToDefine.push(stack[key]);
		}
	}
}

defineStacks(...(stacksToDefine as never[]));
