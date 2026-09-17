#!/usr/bin/env node
// Controlled local fixture for the pi-runtime controlled executor (Task 7).
// Only ever spawned by tests with fixture-owned argument paths. Every mode is
// a local Node fixture: no AWS calls, no arbitrary process kills, and probes
// use signal 0 on fixture-owned PIDs only.
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const [mode, ...args] = process.argv.slice(2);

const writeJson = (path, value) => {
	fs.writeFileSync(path, JSON.stringify(value));
};

/** Sleep forever while ignoring SIGTERM (used for forced-termination paths). */
const hangIgnoringTerm = () => {
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 60_000);
};

const modes = {
	echo: ([text]) => {
		process.stdout.write(`${text}\n`);
	},
	fail: ([text, code]) => {
		process.stderr.write(`${text}\n`);
		process.exitCode = Number(code ?? 7);
	},
	flood: () => {
		// 70 KiB per stream exceeds the 64 KiB capture cap; write it all before
		// exiting so the executor must drain past the cap or deadlock.
		const chunk = Buffer.alloc(1024, 0x61);
		for (let i = 0; i < 70; i += 1) process.stdout.write(chunk);
		for (let i = 0; i < 70; i += 1) process.stderr.write(chunk);
	},
	cwd: () => {
		process.stdout.write(process.cwd());
	},
	env: () => {
		const wanted = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (/^AWS_|^CDK_DEFAULT_/i.test(key)) wanted[key] = value;
		}
		process.stdout.write(JSON.stringify(wanted));
	},
	record: ([jsonPath, code]) => {
		// Persist pid + AWS_CONFIG_FILE, then exit with the requested code.
		writeJson(jsonPath, {
			pid: process.pid,
			awsConfigFile: process.env.AWS_CONFIG_FILE ?? "",
		});
		process.exitCode = Number(code ?? 0);
	},
	hold: ([jsonPath]) => {
		// Default SIGTERM handling (graceful termination path).
		writeJson(jsonPath, { pid: process.pid });
		setInterval(() => {}, 60_000);
	},
	trap: ([jsonPath, variant]) => {
		if (variant === "grandchild") {
			hangIgnoringTerm();
			return;
		}
		// Ignore SIGTERM and spawn an equally resistant grandchild that stays
		// in the same owned process group.
		process.on("SIGTERM", () => {});
		const grandchild = spawn(
			process.execPath,
			[__filename, "trap", jsonPath, "grandchild"],
			{ stdio: "ignore" },
		);
		grandchild.unref();
		writeJson(jsonPath, {
			pid: process.pid,
			grandchild: grandchild.pid,
		});
		setInterval(() => {}, 60_000);
	},
};

const handler = modes[mode];
if (typeof handler !== "function") {
	process.stderr.write(`unknown fixture mode: ${String(mode)}\n`);
	process.exitCode = 64;
} else {
	handler(args);
}
