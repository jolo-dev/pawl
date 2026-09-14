import { createCliRenderer } from "@opentui/core";
import {
	printCodeCommitInitResult,
	runCodeCommitInit,
} from "./src/codecommit-init";
import {
	printCodePipelineInitResult,
	runCodePipelineInit,
} from "./src/codepipeline-init";
import { startPawlServer } from "./src/launch";
import { createPawlApp } from "./src/tui/app";
import { createEveTransport } from "./src/tui/client";
import { runPreflight } from "./src/tui/preflight";
import { defaultPreflightDeps } from "./src/tui/preflight-deps";
import { createPresenter } from "./src/tui/presenter";
import { createInputQueue, createTuiPrompter } from "./src/tui/prompter";
import { runInteractiveSession } from "./src/tui/session";

const argv = process.argv.slice(2);

// Dispatch codecommit subcommand before generic init
if (argv[0] === "init" && argv[1] === "codecommit") {
	try {
		const result = await runCodeCommitInit({
			argv: argv.slice(2),
			cwd: process.cwd(),
			isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
		});
		console.log(printCodeCommitInitResult(result));
		process.exit(0);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

// Dispatch codepipeline subcommand before generic init
if (argv[0] === "init" && argv[1] === "codepipeline") {
	try {
		const result = await runCodePipelineInit({
			argv: argv.slice(2),
			cwd: process.cwd(),
			isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
		});
		console.log(printCodePipelineInitResult(result));
		process.exit(0);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (argv[0] === "init") {
	const { parseInitArgs } = await import("./src/scaffold/cli");
	const { installScaffoldDependencies, runPawlInit, writeScaffoldProject } =
		await import("./src/scaffold");
	const overrides = parseInitArgs(argv);
	const config = await runPawlInit({ cwd: process.cwd(), overrides });
	const written = await writeScaffoldProject(config);
	if (config.installNow) {
		console.log("Installing dependencies...");
		await installScaffoldDependencies(config);
		console.log("Dependencies installed.");
	}
	console.log(
		`Created pawl project "${config.projectName}" in ${config.projectDir} with ${written.length} files.`,
	);
	process.exit(0);
}

/**
 * The agent session.
 *
 * The client owns the terminal from here: `eve dev` runs headless alongside it
 * and is spoken to over the session API. The AWS pre-flight runs inside the
 * transcript rather than above it, so the profile and model a user chose stay in
 * the scrollback with the conversation they belong to.
 */
const projectDir = process.cwd();
const renderer = await createCliRenderer({ exitOnCtrlC: false });
const inputQueue = createInputQueue();
const app = createPawlApp({
	renderer,
	onSubmit: (text) => inputQueue.submit(text),
});
renderer.root.add(app.root);
app.focusInput();

const presenter = createPresenter({
	append: (role, text) => app.append(role, text),
	updateLast: (role, text) => app.updateLast(role, text),
	setStatus: (text, role) => app.setStatus(text, role),
	clearTranscript: () => app.clearTranscript(),
});

let server: Awaited<ReturnType<typeof startPawlServer>> | undefined;
const shutdown = async (code: number): Promise<never> => {
	await server?.stop();
	renderer.destroy();
	process.exit(code);
};

try {
	const outcome = await runPreflight(
		defaultPreflightDeps(),
		createTuiPrompter({ app, input: inputQueue }),
	);

	if (!outcome.ok) {
		// The reason is already in the transcript for a failure the pre-flight
		// reported; cancellation is silent on purpose.
		if (!outcome.cancelled) app.append("alert", outcome.reason);
		await shutdown(outcome.cancelled ? 0 : 1);
	} else {
		const { result } = outcome;
		app.setStatus("Starting the runtime");
		server = await startPawlServer({
			profile: result.profile,
			region: result.region,
			modelId: result.modelId,
			projectDir,
		});
		app.append(
			"notice",
			`profile ${result.profile} | region ${result.region} | model ${result.modelName}`,
		);

		const transport = createEveTransport({ host: server.url });
		const session = await transport.start(
			"Greet me in one short sentence, then say you can scan my AWS account. Do not call any tools.",
		);

		await runInteractiveSession({
			session,
			view: {
				present: (state) => presenter.present(state),
				alert: (text) => app.append("alert", text),
			},
			input: inputQueue,
		});
	}
} catch (error: unknown) {
	app.append("alert", error instanceof Error ? error.message : String(error));
	app.setStatus("Failed", "alert");
} finally {
	await server?.stop();
	renderer.destroy();
}
