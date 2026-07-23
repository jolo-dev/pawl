import { repositoryConfigSchema, type RepositoryConfig } from "../domain/repository-config";
import type { RequestRef } from "../domain/review-request";
import type { SourceControlProvider } from "../ports/source-control-provider";

/** Path to the per-repository reviewer configuration file. */
export const REPOSITORY_CONFIG_PATH = ".pawl/reviewer.json";

/** Safe defaults used when the config is absent or malformed. */
export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = repositoryConfigSchema.parse({
  version: 1,
});

/** Minimal logger the loader accepts (Powertools Logger satisfies this). */
export interface LoaderLogger {
  warn(message: string, data?: Record<string, unknown>): void;
}

export interface RepositoryConfigLoader {
  load(ref: RequestRef, destinationRevision: string): Promise<RepositoryConfig>;
}

export interface ProviderRepositoryConfigLoaderOptions {
  readonly provider: SourceControlProvider;
  readonly logger?: LoaderLogger;
}

/**
 * Loads `.pawl/reviewer.json` from the reviewed repository at the immutable
 * destination commit. A PR cannot weaken its own review policy because the
 * config is read from the protected mainline, not the PR source.
 *
 * On absent file or parse failure, falls back to {@link DEFAULT_REPOSITORY_CONFIG}
 * and logs a warning — a typo must not block reviews.
 */
export class ProviderRepositoryConfigLoader implements RepositoryConfigLoader {
  readonly #provider: SourceControlProvider;
  readonly #logger?: LoaderLogger;

  constructor(options: ProviderRepositoryConfigLoaderOptions) {
    this.#provider = options.provider;
    this.#logger = options.logger;
  }

  async load(ref: RequestRef, destinationRevision: string): Promise<RepositoryConfig> {
    const raw = await this.#provider.getFile(ref, destinationRevision, REPOSITORY_CONFIG_PATH);
    if (raw === undefined) return DEFAULT_REPOSITORY_CONFIG;
    try {
      const parsed: unknown = JSON.parse(raw);
      return repositoryConfigSchema.parse(parsed);
    } catch (error) {
      this.#logger?.warn("repository config parse failed; using defaults", {
        path: REPOSITORY_CONFIG_PATH,
        error: error instanceof Error ? error.message : String(error),
      });
      return DEFAULT_REPOSITORY_CONFIG;
    }
  }
}

/** Always returns defaults; used by tests that don't exercise config loading. */
export class NoopRepositoryConfigLoader implements RepositoryConfigLoader {
  async load(): Promise<RepositoryConfig> {
    return DEFAULT_REPOSITORY_CONFIG;
  }
}
