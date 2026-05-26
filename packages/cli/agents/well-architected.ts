import type { FlueContext } from "@flue/runtime";
import { local } from "@flue/runtime/node";
import * as v from "valibot";
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

	const prompt = await pawl.commands.wellArchitected();
	const { data } = await session.prompt(prompt, {
		result: v.object({
			pillars: v.array(
				v.object({
					pillar: v.string(),
					currentState: v.string(),
					risks: v.array(v.string()),
					recommendations: v.array(
						v.object({
							text: v.string(),
							priority: v.picklist(["high", "medium", "low"]),
						}),
					),
				}),
			),
		}),
	});

	return data;
}
