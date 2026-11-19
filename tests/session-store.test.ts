import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "../src/store/session-store.js";

describe("SessionStore", () => {
  it("persists and reloads thread sessions across instances", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-slack-test-"));
    const storePath = path.join(tmpDir, "sessions.json");

    try {
      const store1 = new SessionStore(storePath);
      store1.upsert("C123", "1700000000.000100", {
        conversationId: "conv-abc",
        model: "gemini-pro",
        mode: "plan",
      });

      const store2 = new SessionStore(storePath);
      const reloaded = store2.get("C123", "1700000000.000100");
      assert.equal(reloaded?.conversationId, "conv-abc");
      assert.equal(reloaded?.model, "gemini-pro");
      assert.equal(reloaded?.mode, "plan");

      assert.equal(store2.resetConversation("C123", "1700000000.000100"), true);
      assert.equal(store2.get("C123", "1700000000.000100")?.conversationId, undefined);
      assert.equal(store2.get("C123", "1700000000.000100")?.model, "gemini-pro");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
