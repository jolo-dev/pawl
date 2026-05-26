import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { PawlHarness } from "./harness";

export const pawlCommands: ExtensionFactory = (pi) => {
	pi.registerCommand("plan", {
		description: "Analyze codebase and generate AWS infrastructure plan",
		handler: async (args, ctx) => {
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
			});
			const prompt = await harness.commands.plan(args);
			await ctx.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("generate", {
		description: "Generate CDK infrastructure code from approved plan",
		handler: async (_args, ctx) => {
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
			});
			const prompt = await harness.commands.generate();
			await ctx.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("well-architected", {
		description: "Run AWS Well-Architected Framework review",
		handler: async (_args, ctx) => {
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
			});
			const prompt = await harness.commands.wellArchitected();
			await ctx.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("cost", {
		description: "Analyze and optimize AWS costs",
		handler: async (_args, ctx) => {
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: async (cmd, cmdArgs) => ctx.exec(cmd, cmdArgs),
			});
			const prompt = await harness.commands.cost();
			await ctx.sendUserMessage(prompt);
		},
	});

	// Placeholder commands (not yet implemented)
	for (const cmd of ["deploy", "init", "simulate"]) {
		pi.registerCommand(cmd, {
			description: `${cmd} (not yet implemented)`,
			handler: async () => {
				// TODO: implement
			},
		});
	}
};
