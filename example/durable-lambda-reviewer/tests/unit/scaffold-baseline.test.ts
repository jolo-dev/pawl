import { expect, it } from "bun:test";
import packageJson from "../../package.json";

it("uses Bun's test runner without recursive script invocation", () => {
  expect(packageJson.scripts.test).toBe("bun test");
});
