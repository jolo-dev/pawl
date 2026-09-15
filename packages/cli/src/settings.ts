import { randomUUID } from "node:crypto";
import {
	appendFile,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const plainString = (max: number) =>
	z
		.string()
		.refine(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject terminal controls before trimming.
			(value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value),
			"Terminal control characters are not allowed",
		)
		.transform((value) => value.trim())
		.pipe(z.string().min(1).max(max));

export const projectSettingsSchema = z
	.object({
		version: z.literal(1),
		profile: plainString(256),
		region: plainString(64),
		modelId: plainString(256),
		modelName: plainString(256),
	})
	.strict();

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type SettingsLoad =
	| { readonly kind: "missing" }
	| { readonly kind: "saved"; readonly settings: ProjectSettings }
	| { readonly kind: "unusable"; readonly reason: string };

export interface ProjectSettingsStore {
	load(): Promise<SettingsLoad>;
	save(selection: Omit<ProjectSettings, "version">): Promise<void>;
}

export class SettingsError extends Error {}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

async function filesystemOperation<T>(
	operation: string,
	path: string,
	run: () => Promise<T>,
): Promise<T> {
	try {
		return await run();
	} catch (cause) {
		throw new SettingsError(
			`Cannot ${operation} at ${path}. Check permissions and the path before retrying.`,
			{ cause },
		);
	}
}

async function checkPath(path: string, kind: "directory" | "file") {
	const stat = await filesystemOperation("inspect path", path, async () => {
		try {
			return await lstat(path);
		} catch (error) {
			if (hasCode(error, "ENOENT")) return undefined;
			throw error;
		}
	});
	if (stat?.isSymbolicLink()) {
		throw new SettingsError(
			`Refusing symbolic link at ${path}. Remove or replace it with a project-local ${kind}.`,
		);
	}
	if (stat && !(kind === "directory" ? stat.isDirectory() : stat.isFile())) {
		throw new SettingsError(
			`Expected a ${kind} at ${path}. Remove or replace this path before saving settings.`,
		);
	}
	return stat;
}

const ignoreBlock =
	"# pawl local startup settings\n/settings.json\n/.settings-*.tmp";

async function protectSettings(directory: string) {
	const path = resolve(directory, ".gitignore");
	const stat = await checkPath(path, "file");
	const contents = stat
		? await filesystemOperation("read ignore rules", path, () =>
				readFile(path, "utf8"),
			)
		: "";
	const withoutFinalNewline = contents.endsWith("\n")
		? contents.slice(0, -1)
		: contents;
	if (
		withoutFinalNewline === ignoreBlock ||
		withoutFinalNewline.endsWith(`\n${ignoreBlock}`)
	) {
		return;
	}
	// Keep our rules last so existing negations cannot expose local settings.
	const separator = contents && !contents.endsWith("\n") ? "\n" : "";
	await filesystemOperation("append ignore rules", path, () =>
		appendFile(path, `${separator}${ignoreBlock}\n`, {
			flag: stat ? "a" : "wx",
		}),
	);
}

export function createProjectSettingsStore(
	projectDir: string,
	// A per-store rename seam permits failure tests without global filesystem mocks.
	options: { readonly rename?: typeof rename } = {},
): ProjectSettingsStore {
	const directory = resolve(projectDir, ".pawl");
	const file = resolve(directory, "settings.json");
	const unusable = (reason: string): SettingsLoad => ({
		kind: "unusable",
		reason,
	});

	return {
		async load() {
			try {
				const directoryStat = await lstat(directory);
				if (directoryStat.isSymbolicLink()) {
					return unusable(
						`Refusing symbolic link at ${directory}. Replace it with a project-local directory.`,
					);
				}
				if (!directoryStat.isDirectory()) {
					return unusable(
						`Expected a directory at ${directory}. Remove or replace this path before configuring settings.`,
					);
				}
				const fileStat = await lstat(file);
				if (fileStat.isSymbolicLink()) {
					return unusable(
						`Refusing symbolic link at ${file}. Remove or replace it with a project-local settings file.`,
					);
				}
				if (!fileStat.isFile()) {
					return unusable(
						`Expected a regular file at ${file}. Remove or replace this path before configuring settings.`,
					);
				}
				const contents = await readFile(file, "utf8");
				let parsed: unknown;
				try {
					parsed = JSON.parse(contents);
				} catch {
					return unusable(
						`Invalid JSON in ${file}. Repair the file or configure replacement settings.`,
					);
				}
				const result = projectSettingsSchema.safeParse(parsed);
				if (!result.success) {
					return unusable(
						`Invalid settings in ${file}. Check the version 1 schema and fields, or configure replacement settings.`,
					);
				}
				return { kind: "saved", settings: result.data };
			} catch (error) {
				if (hasCode(error, "ENOENT")) return { kind: "missing" };
				return unusable(
					`Cannot read settings at ${file}. Check permissions and that ${directory} is accessible, or repair the settings path.`,
				);
			}
		},
		async save(selection) {
			const result = projectSettingsSchema.safeParse({
				version: 1,
				profile: selection.profile,
				region: selection.region,
				modelId: selection.modelId,
				modelName: selection.modelName,
			});
			if (!result.success) {
				throw new SettingsError(
					`Invalid settings for ${file}. Check the version 1 fields before saving.`,
				);
			}
			const contents = `${JSON.stringify(result.data, null, 2)}\n`;
			if (!(await checkPath(directory, "directory"))) {
				await filesystemOperation("create settings directory", directory, () =>
					mkdir(directory),
				);
			}
			await checkPath(file, "file");
			await protectSettings(directory);

			const temporary = resolve(directory, `.settings-${randomUUID()}.tmp`);
			let owned = false;
			try {
				await filesystemOperation(
					"write temporary settings",
					temporary,
					async () => {
						const handle = await open(temporary, "wx", 0o600);
						owned = true;
						try {
							await handle.writeFile(contents, "utf8");
						} finally {
							await handle.close();
						}
					},
				);
				await checkPath(file, "file");
				await filesystemOperation("rename temporary settings", file, () =>
					(options.rename ?? rename)(temporary, file),
				);
				owned = false;
			} catch (error) {
				if (owned) {
					try {
						await filesystemOperation(
							"clean up temporary settings",
							temporary,
							() => unlink(temporary),
						);
					} catch (cleanupError) {
						throw new SettingsError(
							`${error instanceof Error ? error.message : "Settings save failed."} Could not clean up temporary settings at ${temporary}; remove it before retrying.`,
							{ cause: new AggregateError([error, cleanupError]) },
						);
					}
				}
				throw error;
			}
		},
	};
}
