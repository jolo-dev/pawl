import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const pawlCommands: ExtensionFactory = (pi) => {
	pi.registerCommand("well-architected", {
		description: "Run AWS Well-Architected Framework review",
		handler: async (_args, _ctx) => {
			// TODO: implement
		},
	});

	pi.registerCommand("deploy", {
		description: "Deploy infrastructure with CDK",
		handler: async (_args, _ctx) => {
			// TODO: implement
		},
	});

	pi.registerCommand("init", {
		description: "Initialize a new pawl project",
		handler: async (_args, _ctx) => {
			// TODO: implement
		},
	});

	pi.registerCommand("cost", {
		description: "Analyze and optimize AWS costs",
		handler: async (_args, _ctx) => {
			// TODO: implement
		},
	});

	pi.registerCommand("simulate", {
		description: "Simulate infrastructure changes",
		handler: async (_args, _ctx) => {
			// TODO: implement
		},
	});
};
