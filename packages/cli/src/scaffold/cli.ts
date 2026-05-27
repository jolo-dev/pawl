import { parseArgs } from "node:util";
import type { ScaffoldPackageManager, ScaffoldTestMode } from "./types";

export interface InitCliFlags {
	projectName?: string;
	packageManager?: ScaffoldPackageManager;
	awsProfile?: string;
	testMode?: ScaffoldTestMode;
}

export function parseInitArgs(argv: string[]): InitCliFlags {
	const args = argv[0] === "init" ? argv.slice(1) : argv;
	const parsed = parseArgs({
		args,
		options: {
			name: { type: "string" },
			"package-manager": { type: "string" },
			"aws-profile": { type: "string" },
			"test-mode": { type: "string" },
		},
		allowPositionals: true,
	});

	return {
		projectName: parsed.values.name,
		packageManager: parsed.values["package-manager"] as
			| ScaffoldPackageManager
			| undefined,
		awsProfile: parsed.values["aws-profile"],
		testMode: parsed.values["test-mode"] as ScaffoldTestMode | undefined,
	};
}
