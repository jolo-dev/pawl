import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REPOSITORY_CONFIG,
  ProviderRepositoryConfigLoader,
} from "../../../src/reviewer/services/repository-config-loader";
import type { SourceControlProvider } from "../../../src/reviewer/ports/source-control-provider";
import type { RequestRef } from "../../../src/reviewer/domain/review-request";

function fakeProvider(fileContents: string | undefined): SourceControlProvider {
  return {
    getFile: async () => fileContents,
  } as unknown as SourceControlProvider;
}

const request = { provider: "codecommit", repository: "repo", requestId: "7" } as const;

describe("ProviderRepositoryConfigLoader", () => {
  test("parses a present, valid config", async () => {
    const raw = JSON.stringify({
      version: 1,
      checks: [{ name: "types", command: "bunx tsc --noEmit" }],
      install: { command: "bun install --frozen-lockfile" },
      review: { maxChangedFiles: 50, maxModelTokens: 200_000 },
    });
    const loader = new ProviderRepositoryConfigLoader({
      provider: fakeProvider(raw),
    });

    const config = await loader.load(request, "destination-immutable-commit-1234567");

    expect(config.checks).toHaveLength(1);
    expect(config.checks[0]?.name).toBe("types");
    expect(config.install?.command).toBe("bun install --frozen-lockfile");
    expect(config.review.maxChangedFiles).toBe(50);
    expect(config.review.maxModelTokens).toBe(200_000);
  });

  test("falls back to defaults when the file is absent", async () => {
    const loader = new ProviderRepositoryConfigLoader({
      provider: fakeProvider(undefined),
    });

    const config = await loader.load(request, "destination-immutable-commit-1234567");

    expect(config).toEqual(DEFAULT_REPOSITORY_CONFIG);
    expect(config.checks).toHaveLength(0);
  });

  test("falls back to defaults and warns on malformed JSON", async () => {
    const warned: string[] = [];
    const loader = new ProviderRepositoryConfigLoader({
      provider: fakeProvider("not json at all"),
      logger: { warn: (m: string) => warned.push(m) },
    });

    const config = await loader.load(request, "destination-immutable-commit-1234567");

    expect(config).toEqual(DEFAULT_REPOSITORY_CONFIG);
    expect(warned.length).toBeGreaterThan(0);
  });

  test("falls back to defaults and warns on schema-invalid config", async () => {
    const warned: string[] = [];
    const loader = new ProviderRepositoryConfigLoader({
      provider: fakeProvider(JSON.stringify({ version: 99 })),
      logger: { warn: (m: string) => warned.push(m) },
    });

    const config = await loader.load(request, "destination-immutable-commit-1234567");

    expect(config).toEqual(DEFAULT_REPOSITORY_CONFIG);
    expect(warned.length).toBeGreaterThan(0);
  });

  test("reads the config at the destination commit, not the source commit", async () => {
    let observedRevision: string | undefined;
    const provider: SourceControlProvider = {
      getFile: async (_ref: RequestRef, revision: string) => {
        observedRevision = revision;
        return undefined;
      },
    } as unknown as SourceControlProvider;
    const loader = new ProviderRepositoryConfigLoader({ provider });

    await loader.load(request, "destination-immutable-commit-1234567");

    expect(observedRevision).toBe("destination-immutable-commit-1234567");
  });
});
