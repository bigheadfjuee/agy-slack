import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToSlackMrkdwn, splitSlackMessage } from "../src/slack/formatter.js";

describe("markdownToSlackMrkdwn", () => {
  it("converts headings, bold, links, and strikethrough while preserving code blocks", () => {
    const input = [
      "## Title",
      "Check **bold** and ~~old~~ and [Docs](https://antigravity.google/docs).",
      "```ts",
      "const x = '**not bold**';",
      "```",
    ].join("\n");

    const out = markdownToSlackMrkdwn(input);
    assert.match(out, /^\*Title\*/m);
    assert.match(out, /Check \*bold\* and ~old~ and <https:\/\/antigravity\.google\/docs\|Docs>\./);
    assert.match(out, /```\nconst x = '\*\*not bold\*\*';\n```/);
  });
});

describe("splitSlackMessage", () => {
  it("returns single chunk for short messages", () => {
    assert.deepEqual(splitSlackMessage("Hello", 100), ["Hello"]);
  });

  it("splits long messages and balances fenced code blocks", () => {
    const body = "```\n" + "line of code\n".repeat(20) + "```";
    const chunks = splitSlackMessage(body, 100);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      const fenceCount = (chunk.match(/```/g) ?? []).length;
      assert.equal(fenceCount % 2, 0, `Unbalanced code fence in chunk: ${chunk}`);
    }
  });
});
