import { outro } from "@clack/prompts";
import { createCliRenderer } from "@opentui/core";
import {
	printCodeCommitInitResult,
	runCodeCommitInit,
} from "./src/codecommit-init";
import {
	printCodePipelineInitResult,
	runCodePipelineInit,
} from "./src/codepipeline-init";
import { createHostExec } from "./src/host-exec";
import { runProjectScan } from "./src/infra/project-scan";
import { startPawlServer } from "./src/launch";
import { createProjectSettingsStore } from "./src/settings";
import { createPawlApp, type ResourceLine } from "./src/tui/app";
import { clackBookends, createClackPrompter } from "./src/tui/clack-prompter";
import { createEveTransport } from "./src/tui/client";
import { defaultPreflightDeps } from "./src/tui/preflight-deps";
import { createPresenter } from "./src/tui/presenter";
import { createInputQueue } from "./src/tui/prompter";
import { runInteractiveSession } from "./src/tui/session";
import { runStartup } from "./src/tui/startup";
import { THEME } from "./src/tui/theme";

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
 * The pre-flight runs as a plain terminal flow: choosing a profile and a model
 * is a one-off decision that clack's prompts do well, and the client takes the
 * terminal after that. The runtime runs headless alongside the client, and the
 * account's resources are shown next to the conversation.
 */
const projectDir = process.cwd();
const bookends = clackBookends("pawl — your AI agent for AWS infrastructure");
bookends.begin();

const outcome = await runStartup({
	store: createProjectSettingsStore(projectDir),
	deps: defaultPreflightDeps(),
	prompter: createClackPrompter(),
});

if (!outcome.ok) {
	if (!outcome.cancelled) outro(outcome.reason);
	process.exit(outcome.cancelled ? 0 : 1);
}

const { result } = outcome;
outro(
	`Starting — profile ${result.profile} | region ${result.region} | model ${result.modelName}`,
);

const server = await startPawlServer({
	profile: result.profile,
	region: result.region,
	modelId: result.modelId,
	projectDir,
});

const renderer = await createCliRenderer({
	exitOnCtrlC: true,
	backgroundColor: THEME.background,
});

const input = createInputQueue();
const app = createPawlApp({
	renderer,
	onSubmit: (text) => input.submit(text),
});
renderer.root.add(app.root);
app.focusInput();

const presenter = createPresenter({
	append: (role, text) => app.append(role, text),
	updateLast: (role, text) => app.updateLast(role, text),
	setStatus: (text, role) => app.setStatus(text, role),
	clearTranscript: () => app.clearTranscript(),
});

// The resources pane is filled by the client itself, because reading the
// account does not depend on the agent asking for it.
app.setResourcesStatus("Scanning the account…");
void runProjectScan({
	cwd: projectDir,
	region: result.region,
	exec: createHostExec(projectDir),
}).then(
	(outcome) => {
		const lines: ResourceLine[] = [];
		if (outcome.driftUnavailable) {
			lines.push({ text: outcome.driftUnavailable, kind: "empty" });
		}
		lines.push({
			text: `${outcome.report.deployedCount} deployed in ${outcome.report.region}`,
			kind: "service",
		});
		for (const entry of outcome.report.entries) {
			lines.push({
				text:
					entry.status === "not-deployed"
						? `− ${entry.name}`
						: `• ${entry.name}`,
				kind: "resource",
			});
		}
		lines.push({
			text: outcome.suggestionSummary
				.map((entry) => `${entry.construct} ×${entry.count}`)
				.join(", "),
			kind: "empty",
		});
		app.setResources(lines);
	},
	(error: unknown) => {
		app.setResourcesStatus(
			error instanceof Error ? error.message : String(error),
			true,
		);
	},
);

const transport = createEveTransport({ host: server.url });
const session = await transport.start(
	"Greet me in one short sentence, then say you can scan my AWS account. Do not call any tools.",
);

try {
	await runInteractiveSession({
		session,
		view: {
			present: (state) => presenter.present(state),
			alert: (text) => app.append("alert", text),
		},
		input,
	});
} finally {
	await server.stop();
	renderer.destroy();
}
