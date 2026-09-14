import { describe, expect, test } from "bun:test";
import { localServerUrl, waitForHealthy } from "../src/launch";

describe("localServerUrl", () => {
	test("binds loopback, so the runtime is not exposed to the network", () => {
		expect(localServerUrl(2145)).toBe("http://127.0.0.1:2145");
	});
});

describe("waitForHealthy", () => {
	test("resolves as soon as the check passes", async () => {
		let attempts = 0;
		const slept: number[] = [];

		await waitForHealthy("http://127.0.0.1:1", {
			check: async () => {
				attempts++;
				return attempts >= 2;
			},
			sleep: async (ms) => {
				slept.push(ms);
			},
		});

		expect(attempts).toBe(2);
		expect(slept).toEqual([250]);
	});

	test("does not sleep after the server answers", async () => {
		const slept: number[] = [];

		await waitForHealthy("http://127.0.0.1:1", {
			check: async () => true,
			sleep: async (ms) => {
				slept.push(ms);
			},
		});

		expect(slept).toEqual([]);
	});

	test("fails fast when the server died during startup", async () => {
		let attempts = 0;

		await expect(
			waitForHealthy("http://127.0.0.1:1", {
				check: async () => {
					attempts++;
					return false;
				},
				sleep: async () => {},
				hasExited: () => true,
			}),
		).rejects.toThrow("exited before it became healthy");

		// Waiting out the full timeout would report a timeout for a dead process,
		// which sends the reader looking in the wrong place.
		expect(attempts).toBe(0);
	});

	test("gives up with the URL in the message", async () => {
		await expect(
			waitForHealthy("http://127.0.0.1:2145", {
				timeoutMs: 0,
				check: async () => false,
				sleep: async () => {},
			}),
		).rejects.toThrow("http://127.0.0.1:2145");
	});

	test("stops polling once the deadline passes", async () => {
		let attempts = 0;

		await expect(
			waitForHealthy("http://127.0.0.1:1", {
				timeoutMs: 10,
				intervalMs: 1,
				check: async () => {
					attempts++;
					return false;
				},
			}),
		).rejects.toThrow();

		expect(attempts).toBeGreaterThan(0);
	});
});
