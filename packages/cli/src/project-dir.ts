/**
 * Directory the agent operates on.
 *
 * `eve dev` runs with the pawl CLI package as its working directory, because
 * that is where `agent/` lives. `process.cwd()` therefore points at the CLI,
 * not at the user's project. The launcher passes the directory the user
 * actually invoked pawl from through `PAWL_PROJECT_DIR`.
 *
 * Falling back to `process.cwd()` keeps an in-repo `eve dev` session working
 * unchanged, since there the package directory *is* the project.
 */
export function projectDir(env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = env.PAWL_PROJECT_DIR?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : process.cwd();
}
