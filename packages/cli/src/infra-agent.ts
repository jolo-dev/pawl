import {
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { pawlCommands } from "./commands";

export async function startAgent(model: Model<Api>, message: string) {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);

	const settingsManager = SettingsManager.inMemory({
		enableSkillCommands: false,
		skills: [],
	});

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd,
		sessionManager,
		sessionStartEvent,
	}) => {
		const services = await createAgentSessionServices({
			cwd,
			authStorage,
			modelRegistry,
			settingsManager,
			resourceLoaderOptions: {
				extensionFactories: [pawlCommands],
			},
		});
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: process.cwd(),
		agentDir: getAgentDir(),
		sessionManager: SessionManager.create(process.cwd()),
	});

	const mode = new InteractiveMode(runtime, { initialMessage: message });
	await mode.run();
}
