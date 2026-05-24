import { useAgentcore } from "@pawl/agentcore";

const agentcore = useAgentcore("agentcore-integ-test", {
	agent: {
		async invoke(prompt: string) {
			return {
				lastMessage: {
					content: [{ text: `response:${prompt}` }],
				},
			};
		},
	},
});

agentcore.serve({ port: 8080 }).catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
