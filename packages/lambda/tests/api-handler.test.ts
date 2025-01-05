import { describe, expect, it } from "vitest";
import { useApiHandler } from "../src/api-handler";

describe("api-handler", () => {
  const event = require("./api-event.json");
  const context = require("./context.json");
  it("should check the validity of the handler", async () => {
    const handler = useApiHandler("test-service", async (event, logger) => {
      return {
        body: "foo",
        statusCode: 200,
      };
    });
    const response = await handler(event, context, () => {});
    expect(response).toEqual({ body: "foo", statusCode: 200 });
  });
});
