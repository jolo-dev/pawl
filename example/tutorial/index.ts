import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineStacks } from "@hems-lib/cdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stacksDir = path.join(__dirname, "stacks");

const stacksToDefine = []; // Array to hold stack classes

for (const stackDef of fs.readdirSync(stacksDir)) {
	const stack = await import(`${stacksDir}/${stackDef}`);

	// Dynamically find the classes
	for (const key in stack) {
		if (
			typeof stack[key] === "function" &&
			stack[key].prototype.constructor.name !== "Object"
		) {
			stacksToDefine.push(stack[key]);
		}
	}
}

defineStacks(...stacksToDefine);
