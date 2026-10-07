import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { pawlCommands } from "./commands";

export async function startAgent(model: Model<Api>, message: string) {
	const modelRuntime = await ModelRuntime.create();

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
			modelRuntime,
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
