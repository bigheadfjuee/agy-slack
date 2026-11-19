import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientStartupError } from "../src/agy/runner.js";
import type { AgyRunResult } from "../src/agy/types.js";

function makeResult(overrides: Partial<AgyRunResult> = {}): AgyRunResult {
  return {
    response: "",
    status: "ERROR",
    aborted: false,
    exitCode: 1,
    stderr: "",
    ...overrides,
  };
}

describe("isTransientStartupError", () => {
  it("detects eligibility check EOF errors in stderr or response", () => {
    assert.equal(
      isTransientStartupError(
        makeResult({
          stderr:
            'Error: Eligibility check failed: Get "https://www.googleapis.com/oauth2/v2/userinfo": EOF',
        })
      ),
      true
    );

    assert.equal(
      isTransientStartupError(
        makeResult({
          response:
            'Error: Eligibility check failed: Get "https://www.googleapis.com/oauth2/v2/userinfo": TLS handshake timeout',
        })
      ),
      true
    );
  });

  it("does not retry aborted, successful, or non-transient failures", () => {
    assert.equal(
      isTransientStartupError(
        makeResult({
          aborted: true,
          stderr: 'Error: Eligibility check failed: Get "https://www.googleapis.com/oauth2/v2/userinfo": EOF',
        })
      ),
      false
    );

    assert.equal(
      isTransientStartupError(
        makeResult({
          exitCode: 0,
          status: "SUCCESS",
          response: "ok",
        })
      ),
      false
    );

    assert.equal(
      isTransientStartupError(
        makeResult({
          numTurns: 1,
          stderr: 'Error: Eligibility check failed: Get "https://www.googleapis.com/oauth2/v2/userinfo": EOF',
        })
      ),
      false
    );

    assert.equal(
      isTransientStartupError(
        makeResult({
          stderr: "Error: Eligibility check failed: 403 Forbidden",
        })
      ),
      false
    );
  });
});
