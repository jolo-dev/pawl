import { intro, outro } from "@clack/prompts";

intro("create-my-app");

import { stream } from "@clack/prompts";

stream.info(
	(function* () {
		yield "Info!";
	})(),
);
stream.success(
	(function* () {
		yield "Success!";
	})(),
);
stream.step(
	(function* () {
		yield "Step!";
	})(),
);
stream.warn(
	(function* () {
		yield "Warn!";
	})(),
);
stream.error(
	(function* () {
		yield "Error!";
	})(),
);
stream.message(
	(function* () {
		yield "Hello";
		yield ", World";
	})(),
);
outro("You're all set!");
