import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { renderPlanDiagram } from "./diagram";
import { type ExecFn, PawlHarness } from "./harness";
import { runPawlInit, writeScaffoldProject } from "./scaffold";

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

	pi.registerCommand("deploy", {
		description: "Deploy infrastructure with CDK",
		handler: async () => {
			// TODO: implement
		},
	});

	pi.registerCommand("init", {
		description: "Initialize a new pawl project",
		handler: async (_args, ctx) => {
			try {
				const config = await runPawlInit({ cwd: ctx.cwd });
				const written = await writeScaffoldProject({ ...config, cwd: ctx.cwd });
				ctx.ui.notify(
					`Created pawl project "${config.projectName}" with ${written.length} files.`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand("simulate", {
		description: "Simulate infrastructure changes",
		handler: async () => {
			// TODO: implement
		},
	});
};
