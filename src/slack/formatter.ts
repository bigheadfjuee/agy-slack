import type { AgyRunResult } from "../agy/types.js";

const SLACK_MAX_CHARS = 3800;

/**
 * Converts common Markdown syntax to Slack mrkdwn while preserving fenced code blocks.
 */
export function markdownToSlackMrkdwn(markdown: string): string {
  const segments = markdown.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment) => {
      if (segment.startsWith("```") && segment.endsWith("```")) {
        // Strip optional language identifier after opening triple backticks (Slack doesn't highlight it)
        return segment.replace(/^```[a-zA-Z0-9_-]+\r?\n/, "```\n");
      }

      return segment
        // Links: [text](url) -> <url|text>
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
        // Headings: ### Title -> *Title*
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        // Bold: **text** -> *text*
        .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
        // Strikethrough: ~~text~~ -> ~text~
        .replace(/~~([^~\n]+)~~/g, "~$1~");
    })
    .join("");
}

/**
 * Splits long Slack text into chunks under maxChars, preferring paragraph/newline boundaries.
 */
export function splitSlackMessage(text: string, maxChars = SLACK_MAX_CHARS): string[] {
  const normalized = text.trim();
  if (!normalized) return ["_(Empty response)_"];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxChars) {
    let cutIndex = remaining.lastIndexOf("\n\n", maxChars);
    if (cutIndex < maxChars * 0.4) {
      cutIndex = remaining.lastIndexOf("\n", maxChars);
    }
    if (cutIndex < maxChars * 0.4) {
      cutIndex = remaining.lastIndexOf(" ", maxChars);
    }
    if (cutIndex <= 0) {
      cutIndex = maxChars;
    }

    let chunk = remaining.slice(0, cutIndex).trimEnd();
    let rest = remaining.slice(cutIndex).trimStart();

    // If this chunk has an unclosed fenced code block, close it and reopen in the next chunk
    const fenceCount = (chunk.match(/```/g) ?? []).length;
    if (fenceCount % 2 === 1) {
      chunk += "\n```";
      rest = "```\n" + rest;
    }

    chunks.push(chunk);
    remaining = rest;
  }

  if (remaining.trim()) {
    chunks.push(remaining.trim());
  }

  return chunks;
}

export function formatFooter(result: AgyRunResult): string {
  const parts: string[] = [];

  if (result.durationSeconds !== undefined) {
    parts.push(`${result.durationSeconds.toFixed(1)}s`);
  }
  if (result.usage?.total_tokens !== undefined) {
    parts.push(`${result.usage.total_tokens.toLocaleString()} tokens`);
  }
  if (result.conversationId) {
    parts.push(`conv: \`${result.conversationId.slice(0, 8)}\``);
  }

  return parts.length > 0 ? `\n\n_${parts.join(" · ")}_` : "";
}

export function buildStreamingBlocks(
  text: string,
  sessionKey: string,
  statusLine?: string
): Array<Record<string, unknown>> {
  const preview = text.trim()
    ? markdownToSlackMrkdwn(text).slice(-2800)
    : ":hourglass_flowing_sand: *Antigravity is thinking...*";

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: preview,
      },
    },
  ];

  if (statusLine) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:gear: ${statusLine}`,
        },
      ],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Cancel",
        },
        style: "danger",
        action_id: "agy_cancel_run",
        value: sessionKey,
      },
    ],
  });

  return blocks;
}
