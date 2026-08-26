import { parseArgs } from "node:util";
import type {
	ScaffoldPackageManager,
	ScaffoldStage,
	ScaffoldTestMode,
} from "./types";

export interface InitCliFlags {
	projectName?: string;
	packageManager?: ScaffoldPackageManager;
	awsProfile?: string;
	testMode?: ScaffoldTestMode;
	team?: string;
	stage?: ScaffoldStage;
	tags?: Record<string, string>;
	localstackSecretPath?: string;
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
			team: { type: "string" },
			stage: { type: "string" },
			tag: { type: "string", multiple: true },
			"localstack-secret-path": { type: "string" },
		},
		allowPositionals: true,
	});

	const tags: Record<string, string> = {};
	for (const t of parsed.values.tag ?? []) {
		const eq = t.indexOf("=");
		if (eq > 0) {
			tags[t.slice(0, eq)] = t.slice(eq + 1);
		}
	}

	return {
		projectName: parsed.values.name,
		packageManager: parsed.values["package-manager"] as
			| ScaffoldPackageManager
			| undefined,
		awsProfile: parsed.values["aws-profile"],
		testMode: parsed.values["test-mode"] as ScaffoldTestMode | undefined,
		team: parsed.values.team,
		stage: parsed.values.stage as ScaffoldStage | undefined,
		tags: Object.keys(tags).length > 0 ? tags : undefined,
		localstackSecretPath: parsed.values["localstack-secret-path"],
	};
}
