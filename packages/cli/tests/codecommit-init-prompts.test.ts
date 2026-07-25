import { describe, expect, test } from "bun:test";
import type { ValidatedCodeCommitInitCoreConfig } from "../src/codecommit-init/config";
import {
	type CodeCommitInitPromptDeps,
	resolveCorePrompts,
	resolvePostConfirmPrompts,
} from "../src/codecommit-init/prompts";

function makeDeps(
	overrides: Partial<CodeCommitInitPromptDeps> = {},
): CodeCommitInitPromptDeps {
	const calls: string[] = [];
	return {
		promptRepositoryName: async () => {
			calls.push("repo");
			return "my-repo";
		},
		promptSyncExisting: async () => {
			calls.push("syncExisting");
			return true;
		},
		promptSyncPath: async () => {
			calls.push("syncPath");
			return ".";
		},
		promptDirectory: async () => {
			calls.push("directory");
			return undefined;
		},
		promptBranch: async () => {
			calls.push("branch");
			return "main";
		},
		promptTeam: async () => {
			calls.push("team");
			return "platform";
		},
		promptStage: async () => {
			calls.push("stage");
			return "dev" as const;
		},
		promptAutoReviewer: async () => {
			calls.push("auto");
			return false;
		},
		promptModelId: async () => {
			calls.push("model");
			return "eu.anthropic.claude-sonnet-4-6";
		},
		promptConfirm: async () => {
			calls.push("confirm");
			return true;
		},
		promptInstall: async () => {
			calls.push("install");
			return true;
		},
		promptDeploy: async () => {
			calls.push("deploy");
			return false;
		},
		promptAwsProfile: async () => {
			calls.push("profile");
			return "dev";
		},
		promptRegion: async () => {
			calls.push("region");
			return "eu-central-1";
		},
		listProfiles: async () => {
			calls.push("listProfiles");
			return ["dev"];
		},
		getProfileRegion: async () => {
			calls.push("getProfileRegion");
			return "eu-central-1";
		},
		...overrides,
	};
}

describe("resolveCorePrompts", () => {
	test("prompts in the spec order: repo, sync, directory, branch, team, stage, auto, model", async () => {
		const order: string[] = [];
		const deps = makeDeps({
			promptRepositoryName: async () => {
				order.push("repo");
				return "my-repo";
			},
			promptSyncExisting: async () => {
				order.push("syncExisting");
				return true;
			},
			promptSyncPath: async () => {
				order.push("syncPath");
				return ".";
			},
			promptDirectory: async () => {
				order.push("directory");
				return undefined;
			},
			promptBranch: async () => {
				order.push("branch");
				return "main";
			},
			promptTeam: async () => {
				order.push("team");
				return "platform";
			},
			promptStage: async () => {
				order.push("stage");
				return "dev" as const;
			},
			promptAutoReviewer: async () => {
				order.push("auto");
				return false;
			},
		});
		const result = await resolveCorePrompts(deps);
		expect(order).toEqual([
			"repo",
			"syncExisting",
			"syncPath",
			"directory",
			"branch",
			"team",
			"stage",
			"auto",
		]);
		expect(result.repositoryName).toBe("my-repo");
		expect(result.syncPath).toBe(".");
		expect(result.noAutoReviewer).toBe(true);
	});

	test("does not prompt for model when auto-review is disabled", async () => {
		let modelCalled = false;
		const deps = makeDeps({
			promptAutoReviewer: async () => false,
			promptModelId: async () => {
				modelCalled = true;
				return "";
			},
		});
		await resolveCorePrompts(deps);
		expect(modelCalled).toBe(false);
	});

	test("prompts for model when auto-review is enabled", async () => {
		let modelCalled = false;
		const deps = makeDeps({
			promptAutoReviewer: async () => true,
			promptModelId: async () => {
				modelCalled = true;
				return "eu.anthropic.claude-sonnet-4-6";
			},
		});
		const result = await resolveCorePrompts(deps);
		expect(modelCalled).toBe(true);
		expect(result.modelId).toBe("eu.anthropic.claude-sonnet-4-6");
	});

	test("sets noSync when user chooses new project", async () => {
		const deps = makeDeps({
			promptSyncExisting: async () => false,
		});
		const result = await resolveCorePrompts(deps);
		expect(result.noSync).toBe(true);
		expect(result.syncPath).toBeUndefined();
	});
});

describe("resolvePostConfirmPrompts", () => {
	function makeCore(
		overrides: Partial<ValidatedCodeCommitInitCoreConfig> = {},
	): ValidatedCodeCommitInitCoreConfig {
		return {
			repositoryName: "my-repo",
			branchName: "main",
			team: "platform",
			stage: "dev",
			autoReviewer: false,
			...overrides,
		};
	}

	test("honors supplied install=true, prompts deploy; when deploy=true prompts profile then region", async () => {
		const order: string[] = [];
		const deps = makeDeps({
			promptInstall: async () => {
				order.push("install");
				return true;
			},
			promptDeploy: async () => {
				order.push("deploy");
				return true;
			},
			promptAwsProfile: async () => {
				order.push("profile");
				return "dev";
			},
			promptRegion: async () => {
				order.push("region");
				return "eu-central-1";
			},
			listProfiles: async () => {
				order.push("listProfiles");
				return ["dev"];
			},
			getProfileRegion: async () => {
				order.push("getProfileRegion");
				return "eu-central-1";
			},
		});
		const result = await resolvePostConfirmPrompts(
			deps,
			makeCore({ install: true }),
		);
		expect(order).toEqual([
			"deploy",
			"listProfiles",
			"profile",
			"getProfileRegion",
			"region",
		]);
		expect(result).toEqual({
			install: true,
			deploy: true,
			awsProfile: "dev",
			region: "eu-central-1",
		});
	});

	test("install=false sets deploy=false without deploy prompt", async () => {
		let deployCalled = false;
		const deps = makeDeps({
			promptDeploy: async () => {
				deployCalled = true;
				return false;
			},
		});
		const result = await resolvePostConfirmPrompts(
			deps,
			makeCore({ install: false }),
		);
		expect(deployCalled).toBe(false);
		expect(result).toEqual({ install: false, deploy: false });
	});

	test("install=true, deploy=false skips profile/region prompts", async () => {
		let profileCalled = false;
		let regionCalled = false;
		const deps = makeDeps({
			promptDeploy: async () => false,
			promptAwsProfile: async () => {
				profileCalled = true;
				return "";
			},
			promptRegion: async () => {
				regionCalled = true;
				return "";
			},
		});
		const result = await resolvePostConfirmPrompts(
			deps,
			makeCore({ install: true }),
		);
		expect(profileCalled).toBe(false);
		expect(regionCalled).toBe(false);
		expect(result).toEqual({ install: true, deploy: false });
	});

	test("honors supplied deploy=true, only prompts for missing profile and region", async () => {
		const order: string[] = [];
		const deps = makeDeps({
			promptDeploy: async () => {
				order.push("deploy");
				return false;
			},
			promptAwsProfile: async () => {
				order.push("profile");
				return "dev";
			},
			promptRegion: async () => {
				order.push("region");
				return "eu-central-1";
			},
			listProfiles: async () => ["dev"],
			getProfileRegion: async () => "eu-central-1",
		});
		const result = await resolvePostConfirmPrompts(
			deps,
			makeCore({ install: true, deploy: true, awsProfile: "dev" }),
		);
		expect(order).toEqual(["region"]);
		expect(result).toEqual({
			install: true,
			deploy: true,
			awsProfile: "dev",
			region: "eu-central-1",
		});
	});
});
