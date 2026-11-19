import type { AgyStreamEvent } from "./types.js";

/**
 * Parses a single line from `agy --output-format stream-json`.
 * Non-JSON lines (such as CLI warnings) are ignored and return null.
 */
export function parseAgyStreamLine(rawLine: string): AgyStreamEvent | null {
  const trimmed = rawLine.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "event" in parsed &&
      typeof (parsed as { event: unknown }).event === "string"
    ) {
      return parsed as AgyStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Incremental NDJSON line splitter for chunked stdout streams.
 */
export class NdjsonLineSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return lines;
  }

  flush(): string[] {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const remaining = this.buffer;
    this.buffer = "";
    return [remaining];
  }
}
