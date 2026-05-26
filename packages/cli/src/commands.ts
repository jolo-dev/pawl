import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { renderPlanDiagram } from "./diagram";
import { type ExecFn, PawlHarness } from "./harness";

export const pawlCommands: ExtensionFactory = (pi) => {
	pi.registerCommand("plan", {
		description: "Analyze codebase and generate AWS infrastructure plan",
		handler: async (args, ctx) => {
			const piExec: ExecFn = async (cmd, cmdArgs) => {
				const result = await pi.exec(cmd, cmdArgs);
				return { stdout: result.stdout };
			};
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: piExec,
			});
			const prompt = await harness.commands.plan(args);
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("generate", {
		description: "Generate CDK infrastructure code from approved plan",
		handler: async (_args, ctx) => {
			const piExec: ExecFn = async (cmd, cmdArgs) => {
				const result = await pi.exec(cmd, cmdArgs);
				return { stdout: result.stdout };
			};
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: piExec,
			});
			const prompt = await harness.commands.generate();
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("well-architected", {
		description: "Run AWS Well-Architected Framework review",
		handler: async (_args, ctx) => {
			const piExec: ExecFn = async (cmd, cmdArgs) => {
				const result = await pi.exec(cmd, cmdArgs);
				return { stdout: result.stdout };
			};
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: piExec,
			});
			const prompt = await harness.commands.wellArchitected();
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("cost", {
		description: "Analyze and optimize AWS costs",
		handler: async (_args, ctx) => {
			const piExec: ExecFn = async (cmd, cmdArgs) => {
				const result = await pi.exec(cmd, cmdArgs);
				return { stdout: result.stdout };
			};
			const harness = new PawlHarness({
				cwd: ctx.cwd,
				exec: piExec,
			});
			const prompt = await harness.commands.cost();
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("architecture", {
		description: "Render the AWS architecture diagram from the current plan",
		handler: async (_args, ctx) => {
			const piExec: ExecFn = async (cmd, cmdArgs) => {
				const result = await pi.exec(cmd, cmdArgs);
				return { stdout: result.stdout };
			};
			const diagram = await renderPlanDiagram(ctx.cwd, piExec);
			pi.sendUserMessage(diagram);
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
