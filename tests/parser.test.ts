import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NdjsonLineSplitter, parseAgyStreamLine } from "../src/agy/parser.js";

describe("parseAgyStreamLine", () => {
  it("parses init, step_update, and result events", () => {
    const init = parseAgyStreamLine(
      '{"event":"init","conversation_id":"abc-123","init":{"cwd":"C:/repo"}}'
    );
    assert.equal(init?.event, "init");
    assert.equal(init?.conversation_id, "abc-123");

    const delta = parseAgyStreamLine(
      '{"event":"step_update","step_update":{"conversation_id":"abc-123","step_type":"agent_response","text_delta":"Hello"}}'
    );
    assert.equal(delta?.event, "step_update");

    const result = parseAgyStreamLine(
      '{"event":"result","result":{"conversation_id":"abc-123","status":"SUCCESS","response":"Hello world"}}'
    );
    assert.equal(result?.event, "result");
  });

  it("ignores CLI warning lines and blank lines", () => {
    assert.equal(parseAgyStreamLine("warning: --mode plan has no effect"), null);
    assert.equal(parseAgyStreamLine("   "), null);
    assert.equal(parseAgyStreamLine("{not-valid-json"), null);
  });
});

describe("NdjsonLineSplitter", () => {
  it("handles partial chunks and CRLF newlines", () => {
    const splitter = new NdjsonLineSplitter();
    assert.deepEqual(splitter.push('{"event":"init"}\r\n{"ev'), ['{"event":"init"}']);
    assert.deepEqual(splitter.push('ent":"result"}\n{"event":"end"}'), ['{"event":"result"}']);
    assert.deepEqual(splitter.flush(), ['{"event":"end"}']);
    assert.deepEqual(splitter.flush(), []);
  });
});
