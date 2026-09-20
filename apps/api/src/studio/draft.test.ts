import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleCopy, parseStudioDrafts } from "./draft.js";

describe("assembleCopy", () => {
  it("joins hook, body, and hashed tags", () => {
    const copy = assembleCopy({
      hook: "Pickup isn't on any calendar.",
      body: "Amilo still sees it.",
      hashtags: ["Amilo", "#Quiet"],
    });
    assert.equal(
      copy,
      "Pickup isn't on any calendar.\n\nAmilo still sees it.\n\n#Amilo #Quiet",
    );
  });
});

describe("parseStudioDrafts", () => {
  it("reads three options with x and instagram pieces", () => {
    const drafts = parseStudioDrafts({
      options: [
        {
          label: "Pickup",
          hook: "Pickup isn't on any calendar.",
          x: { hook: "Pickup isn't on any calendar.", body: "Amilo still sees it.", hashtags: [] },
          instagram: {
            hook: "Pickup isn't on any calendar.",
            body: "The life that never made it onto Google.",
            hashtags: ["Amilo", "amilo"],
          },
        },
        {
          label: "Quiet",
          hook: "Measured by how little it speaks.",
          twitter: { body: "Most assistants want more of you." },
          ig: { body: "An assistant, on purpose.", hashtags: ["Amilo"] },
        },
        {
          label: "Confirm",
          hook: "Nothing happens without your OK.",
          x: { body: "Amilo proposes. You confirm." },
          instagram: { body: "Confirm-before-write. Invite-only. Link in bio." },
        },
      ],
    });
    assert.equal(drafts.length, 3);
    assert.equal(drafts[0]?.instagram.hashtags.join(","), "Amilo");
    assert.match(drafts[0]?.x.copy ?? "", /Pickup/);
    assert.match(drafts[2]?.instagram.copy ?? "", /Link in bio/);
  });

  it("rejects empty payloads", () => {
    assert.throws(() => parseStudioDrafts({ options: [] }), /No usable drafts/);
  });
});
