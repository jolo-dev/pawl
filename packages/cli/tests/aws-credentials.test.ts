import { describe, expect, it } from "bun:test";
import {
	checkCredentials,
	isSSOTokenValid,
	listProfiles,
	ssoLogin,
} from "../src/aws-credentials";

describe("AWS Credentials", () => {
	it("should load AWS credentials", async () => {
		const profiles = await listProfiles();
		console.log("Loaded AWS profiles:", profiles);
		expect(profiles).toBeInstanceOf(Array);
	});

	it("should check the STS token by profile", async () => {
		const profiles = await listProfiles();
		for (const profile of profiles) {
			try {
				const identity = await checkCredentials(profile);
				console.log(`Profile: ${profile}, Identity:`, identity);
				expect(identity).toHaveProperty("Arn");
			} catch (error) {
				console.warn(
					`Failed to check credentials for profile ${profile}:`,
					error,
				);
			}
		}
	});

	it("should check SSO token validity per profile", async () => {
		const profiles = await listProfiles();
		for (const profile of profiles) {
			const valid = await isSSOTokenValid(profile);
			console.log(`Profile: ${profile}, SSO token valid: ${valid}`);
			expect(typeof valid).toBe("boolean");
		}
	});

	it("should SSO login for a profile", async () => {
		const profiles = await listProfiles();
		const ssoProfile = profiles[0];
		if (!ssoProfile) return;
		await ssoLogin(ssoProfile);
		const valid = await isSSOTokenValid(ssoProfile);
		expect(valid).toBe(true);
	}, 120_000);
});
