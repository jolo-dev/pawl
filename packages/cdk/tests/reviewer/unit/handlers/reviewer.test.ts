import { describe, expect, test } from "bun:test";
import { handler } from "../../../../src/reviewer/handlers/reviewer";

describe("reviewer", () => {
  test("handler is a durable handler function with arity 2", () => {
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(2);
  });
});
