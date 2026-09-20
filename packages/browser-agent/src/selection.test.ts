import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSelectionIds } from "./adapters/grocery.js";
import type { SelectionOption } from "@amilo/booking";

describe("parseSelectionIds", () => {
  const options: SelectionOption[] = [
    { id: "1", label: "Milk" },
    { id: "2", label: "Cheese" },
    { id: "A", label: "Alt" },
  ];

  it("maps numeric and letter ids", () => {
    assert.deepEqual(parseSelectionIds("1 2", options), ["1", "2"]);
    assert.deepEqual(parseSelectionIds("A", options), ["A"]);
    assert.deepEqual(parseSelectionIds("1, A", options), ["1", "A"]);
  });

  it("ignores unknown tokens", () => {
    assert.deepEqual(parseSelectionIds("9 xyz", options), []);
  });
});
