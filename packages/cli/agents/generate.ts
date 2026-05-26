import type { FlueContext } from "@flue/runtime";
import { local } from "@flue/runtime/node";
import { PawlHarness } from "../src/harness";

export const triggers = { webhook: true };

export default async function ({ init, env }: FlueContext) {
	const harness = await init({
		sandbox: local({
			env: {
				AWS_PROFILE: env.AWS_PROFILE as string,
				AWS_REGION: env.AWS_REGION as string,
			},
		}),
		model: (env.FLUE_MODEL as string) ?? "anthropic/claude-sonnet-4-6",
	});
	const session = await harness.session();

	const pawl = new PawlHarness({
		cwd: process.cwd(),
		exec: async (cmd, args) => {
			const result = await session.shell(
				`${cmd} ${args.join(" ")}`,
			);
			return { stdout: result.output };
		},
	});

	const generatePrompt = await pawl.commands.generate();
	await session.prompt(generatePrompt);

	return { status: "generated" };
}
