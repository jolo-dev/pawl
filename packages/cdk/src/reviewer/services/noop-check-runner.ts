import type { CheckRunInput, CheckRunResult, CheckRunner } from "../ports/check-runner";

/**
 * No-op check runner. Runs no builds and returns an empty result. The real
 * implementation (master plan Task 12) starts exact-commit CodeBuild builds
 * and retrieves bounded CloudWatch logs.
 */
export class NoopCheckRunner implements CheckRunner {
  async run(_input: CheckRunInput): Promise<CheckRunResult> {
    return { status: "completed", checks: [] };
  }
}
