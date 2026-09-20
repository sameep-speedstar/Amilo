import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractResponsesText } from "./index.js";

describe("extractResponsesText", () => {
  it("reads output_text convenience field", () => {
    assert.equal(
      extractResponsesText({ output_text: "  hello  ", output: [] }),
      "hello",
    );
  });

  it("reads message content parts", () => {
    const text = extractResponsesText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: '{"intent":{"type":"reply_text","text":"Hi"}}' },
          ],
        },
      ],
    });
    assert.match(text, /reply_text/);
  });
});
