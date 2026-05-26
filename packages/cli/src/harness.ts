import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPTS_DIR = resolve(__dirname, "..", "prompts");

export type ExecFn = (
	cmd: string,
	args: string[],
) => Promise<{ stdout: string }>;

export interface PawlHarnessOptions {
	cwd?: string;
	exec?: ExecFn;
	promptsDir?: string;
}

/** Runtime-agnostic core for pawl CLI operations. */
export class PawlHarness {
	private cwd: string;
	private exec: ExecFn;
	private promptsDir: string;

	constructor(options: PawlHarnessOptions = {}) {
		this.cwd = options.cwd ?? process.cwd();
		this.exec = options.exec ?? this.defaultExec;
		this.promptsDir = options.promptsDir ?? DEFAULT_PROMPTS_DIR;
	}

	/** Scan the codebase and return a structured markdown summary. */
	async scanCodebase(): Promise<string> {
		const results: string[] = [];

		// Directory structure
		try {
			const { stdout } = await this.exec("find", [
				this.cwd,
				"-maxdepth",
				"3",
				"-not",
				"-path",
				"*/node_modules/*",
				"-not",
				"-path",
				"*/.git/*",
				"-not",
				"-path",
				"*/dist/*",
				"-not",
				"-path",
				"*/cdk.out/*",
				"-type",
				"f",
			]);
			const files = stdout.split("\n").filter(Boolean).slice(0, 50);
			results.push(
				`## Project Structure\n\`\`\`text\n${files.join("\n")}\n\`\`\``,
			);
		} catch {
			results.push("## Project Structure\nCould not list files.");
		}

		// Key dependency files
		for (const file of [
			"package.json",
			"requirements.txt",
			"go.mod",
			"Gemfile",
			"pom.xml",
			"Dockerfile",
			"docker-compose.yml",
		]) {
			try {
				const { stdout } = await this.exec("cat", [`${this.cwd}/${file}`]);
				results.push(`## ${file}\n\`\`\`\n${stdout.trim()}\n\`\`\``);
			} catch {
				// File doesn't exist, skip
			}
		}

		// Source files (first 5 non-test, non-config files)
		try {
			const { stdout } = await this.exec("find", [
				this.cwd,
				"-maxdepth",
				"3",
				"-not",
				"-path",
				"*/node_modules/*",
				"-not",
				"-path",
				"*/.git/*",
				"-not",
				"-path",
				"*/dist/*",
				"-not",
				"-path",
				"*/cdk.out/*",
				"-not",
				"-path",
				"*/test/*",
				"-not",
				"-path",
				"*/tests/*",
				"-not",
				"-path",
				"*/__snapshots__/*",
				"-name",
				"*.ts",
				"-o",
				"-name",
				"*.js",
				"-name",
				"*.py",
				"-o",
				"-name",
				"*.go",
			]);
			const srcFiles = stdout.split("\n").filter(Boolean).slice(0, 5);
			for (const file of srcFiles) {
				try {
					const { stdout: content } = await this.exec("head", ["-50", file]);
					results.push(`## ${file}\n\`\`\`\n${content.trim()}\n\`\`\``);
				} catch {
					// Skip if can't read
				}
			}
		} catch {
			// Skip if find fails
		}

		return results.join("\n\n");
	}

	/** Load a prompt markdown file by name (without .md extension). Strips YAML frontmatter. */
	async loadPrompt(name: string): Promise<string> {
		const { stdout } = await this.exec("cat", [
			`${this.promptsDir}/${name}.md`,
		]);
		return stdout.replace(/^---[\s\S]*?---\n?/, "");
	}

	/** Prompt constructors for each workflow command. */
	commands = {
		plan: async (userNotes?: string): Promise<string> => {
			const scanResult = await this.scanCodebase();
			return `Generate an AWS infrastructure plan for this project.

IMPORTANT: The codebase scan is already provided below. Do NOT run additional shell commands (find, cat, ls, grep) to scan files — use the information already provided.

${userNotes ? `User notes: ${userNotes}\n\n` : ""}${scanResult}

Create a structured plan at .pawl/plan.md that covers:
1. Application summary (runtime, framework, type)
2. Proposed architecture (services, network, security, observability)
3. **Architecture diagram** — a Mermaid \`graph TD\` diagram showing all AWS services and their connections
4. Deployment strategy
5. File plan

Wait for my review before generating any code.`;
		},

		generate: async (): Promise<string> => {
			return (
				"Read the approved infrastructure plan at .pawl/plan.md and generate the CDK infrastructure code. " +
				"Use @pawl/cdk constructs and @pawl/lambda handlers. " +
				"Write all files to the infra/ directory. " +
				"Include CDK stacks, Lambda handlers, package.json, tsconfig.json, and cdk.json."
			);
		},

		wellArchitected: async (): Promise<string> => {
			const prompt = await this.loadPrompt("well-architected");
			return prompt;
		},

		cost: async (): Promise<string> => {
			const prompt = await this.loadPrompt("cost");
			return prompt;
		},
	};

	private defaultExec: ExecFn = async () => {
		throw new Error(
			"PawlHarness: no exec function provided. Pass exec in options or use with a runtime that provides shell access.",
		);
	};
}
