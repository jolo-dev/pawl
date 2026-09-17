import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const scenario of [
	"global-profile",
	"service-profile",
	"shared-profile",
	"global-env",
	"global-no-ambient",
	"global-missing-region",
	"global-malformed",
	"global-error",
	"global-cancel",
	"global-auth-env-sigv4a",
	"global-auth-env-sigv4a-first",
	"shared-auth-profile-sigv4a",
	"shared-auth-profile-sigv4a-first",
]) {
	test(`actual fromIni web identity endpoint isolation: ${scenario}`, async () => {
		const home = mkdtempSync(join(tmpdir(), "pawl-web-identity-"));
		try {
			const child = Bun.spawn(
				[
					process.execPath,
					join(import.meta.dir, "fixtures/pi-credential-web-identity.ts"),
					scenario,
				],
				{
					env: {
						PATH: process.env.PATH ?? "",
						HOME: home,
						USERPROFILE: home,
						PAWL_FIXTURE_HOME: home,
						AWS_CONFIG_FILE: join(home, "config"),
						AWS_SHARED_CREDENTIALS_FILE: join(home, "credentials"),
						AWS_PROFILE: "wrong",
						AWS_EC2_METADATA_DISABLED: "true",
						...(scenario === "global-no-ambient" || scenario.includes("-auth-")
							? {}
							: {
									AWS_ACCESS_KEY_ID: "wrong-ambient-key",
									AWS_SECRET_ACCESS_KEY: "wrong-ambient-secret",
								}),
					},
					stdout: "pipe",
					stderr: "pipe",
					timeout: 8000,
				},
			);
			const [exit, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
			const result: unknown = JSON.parse(stdout);
			expect(result).toMatchObject({
				scenario,
				positiveControlDisclosures: 1,
				protectedDisclosures: 0,
				destroyed: 1,
				acquisitions: 1,
				offline: true,
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	}, 10000);
}
