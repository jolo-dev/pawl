/**
 * Shared guard for opt-in AWS integration tests.
 *
 * These tests exercise the full durable reviewer pipeline against disposable
 * CodeCommit resources and a deployed stack. They are SKIPPED (not failed)
 * unless all of the following are set:
 *
 *   RUN_AWS_INTEGRATION=1
 *   AWS_PROFILE          (e.g. jolo)
 *   AWS_REGION           (e.g. eu-central-1)
 *   PAWL_TEST_REPO_A     (disposable repository name for the primary repo)
 *   PAWL_TEST_STACK_NAME (deployed stack name, e.g. jolo-dev-ReviewerStack)
 *
 * `PAWL_TEST_REPO_B` is required only by the two-repository isolation suite.
 * Cleanup is always registered in `afterAll` so a partially-run suite does
 * not leak test PRs or branches.
 */
export const AWS_INTEGRATION_ENABLED = process.env.RUN_AWS_INTEGRATION === "1";
export const AWS_PROFILE = process.env.AWS_PROFILE;
export const AWS_REGION = process.env.AWS_REGION;
export const PAWL_TEST_REPO_A = process.env.PAWL_TEST_REPO_A;
export const PAWL_TEST_REPO_B = process.env.PAWL_TEST_REPO_B;
export const PAWL_TEST_STACK_NAME = process.env.PAWL_TEST_STACK_NAME;
export const PAWL_TEST_TEAM = process.env.PAWL_TEST_TEAM ?? "jolo";
export const PAWL_TEST_STAGE = process.env.PAWL_TEST_STAGE ?? "dev";

export function integrationPrerequisitesMet(requiresRepoB = false): boolean {
  if (!AWS_INTEGRATION_ENABLED) return false;
  if (!AWS_PROFILE || !AWS_REGION || !PAWL_TEST_REPO_A || !PAWL_TEST_STACK_NAME) return false;
  if (requiresRepoB && !PAWL_TEST_REPO_B) return false;
  return true;
}

export const SKIP_REASON =
  "set RUN_AWS_INTEGRATION=1, AWS_PROFILE, AWS_REGION, PAWL_TEST_REPO_A, and PAWL_TEST_STACK_NAME to run live AWS integration tests";
