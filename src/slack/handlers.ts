import type { App } from "@slack/bolt";
import type { AgyMode, AppConfig } from "../config.js";

type WebClient = App["client"];
import type { AgyRunner } from "../agy/runner.js";
import { makeSessionKey, type SessionStore } from "../store/session-store.js";
import type { Logger } from "../utils/logger.js";
import {
  buildStreamingBlocks,
  formatFooter,
  markdownToSlackMrkdwn,
  splitSlackMessage,
} from "./formatter.js";

const VALID_MODES = new Set<AgyMode>(["auto", "accept-edits", "plan"]);

const HELP_TEXT = [
  "*Antigravity CLI (agy) Slack Bridge — Commands*",
  "• Mention me in a channel or send a DM to start a conversation.",
  "• Reply in the same thread to automatically continue the `agy` conversation.",
  "",
  "*In-thread commands:*",
  "• `!status` — Show current thread's conversation ID, model, mode, and workdir",
  "• `!reset` — Clear the thread's conversation ID (start fresh on next message)",
  "• `!cancel` — Abort the currently running `agy` task in this thread",
  "• `!model <name|default>` — Override the model for this thread",
  "• `!mode <auto|accept-edits|plan|default>` — Override the execution mode for this thread",
  "• `!help` — Show this help message",
].join("\n");

export interface ActiveRunsRegistry {
  cancelAll(): void;
  size(): number;
}

export function registerSlackHandlers(params: {
  app: App;
  config: AppConfig;
  runner: AgyRunner;
  store: SessionStore;
  logger: Logger;
  botUserId: string;
}): ActiveRunsRegistry {
  const { app, config, runner, store, logger, botUserId } = params;

  const activeRuns = new Map<string, AbortController>();
  const processedEvents = new Set<string>();

  function markProcessed(channel: string, ts: string): boolean {
    const key = `${channel}:${ts}`;
    if (processedEvents.has(key)) {
      return false;
    }
    processedEvents.add(key);
    if (processedEvents.size > 1000) {
      const oldest = processedEvents.values().next().value;
      if (oldest) processedEvents.delete(oldest);
    }
    return true;
  }

  function checkAuthorization(
    userId: string | undefined,
    channelId: string
  ): { allowed: true } | { allowed: false; reason: string } {
    if (config.allowedUsers.size > 0 && (!userId || !config.allowedUsers.has(userId))) {
      return { allowed: false, reason: "user_not_in_allowlist" };
    }
    if (config.allowedChannels.size > 0 && !config.allowedChannels.has(channelId)) {
      return { allowed: false, reason: "channel_not_in_allowlist" };
    }
    return { allowed: true };
  }

  function stripBotMention(text: string): string {
    return text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
  }

  async function handleCommand(
    client: WebClient,
    channel: string,
    threadTs: string,
    text: string
  ): Promise<boolean> {
    if (!text.startsWith("!")) return false;

    const [rawCmd, ...rest] = text.slice(1).trim().split(/\s+/);
    const cmd = rawCmd?.toLowerCase();
    const arg = rest.join(" ").trim();
    const sessionKey = makeSessionKey(channel, threadTs);

    const reply = async (msg: string): Promise<void> => {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: msg,
      });
    };

    switch (cmd) {
      case "help": {
        await reply(HELP_TEXT);
        return true;
      }

      case "status": {
        const session = store.get(channel, threadTs);
        const running = activeRuns.has(sessionKey);
        const lines = [
          "*Antigravity Session Status*",
          `• Running: ${running ? ":hourglass_flowing_sand: Yes" : "No"}`,
          `• Conversation ID: ${session?.conversationId ? `\`${session.conversationId}\`` : "_(new)_"}`,
          `• Model: \`${session?.model ?? config.agyModel ?? "(default)"}\``,
          `• Mode: \`${session?.mode ?? config.agyMode ?? "(default)"}\``,
          `• Sandbox: \`${config.agySandbox}\``,
          `• Workdir: \`${config.agyWorkdir}\``,
        ];
        await reply(lines.join("\n"));
        return true;
      }

      case "reset": {
        if (activeRuns.has(sessionKey)) {
          activeRuns.get(sessionKey)?.abort();
          activeRuns.delete(sessionKey);
        }
        store.resetConversation(channel, threadTs);
        await reply(":arrows_counterclockwise: Conversation reset. Your next message in this thread will start a new Antigravity session.");
        return true;
      }

      case "cancel": {
        const controller = activeRuns.get(sessionKey);
        if (!controller) {
          await reply("No active Antigravity task is running in this thread.");
          return true;
        }
        controller.abort();
        await reply(":octagonal_sign: Cancellation requested.");
        return true;
      }

      case "model": {
        if (!arg) {
          await reply("Usage: `!model <model-name>` or `!model default`");
          return true;
        }
        const nextModel = arg.toLowerCase() === "default" ? undefined : arg;
        store.upsert(channel, threadTs, { model: nextModel });
        await reply(
          nextModel
            ? `:white_check_mark: Model for this thread set to \`${nextModel}\`.`
            : ":white_check_mark: Model for this thread reset to default."
        );
        return true;
      }

      case "mode": {
        if (!arg) {
          await reply("Usage: `!mode <auto|accept-edits|plan|default>`");
          return true;
        }
        if (arg.toLowerCase() === "default") {
          store.upsert(channel, threadTs, { mode: undefined });
          await reply(":white_check_mark: Mode for this thread reset to default.");
          return true;
        }
        if (!VALID_MODES.has(arg as AgyMode)) {
          await reply(`Invalid mode \`${arg}\`. Choose one of: \`auto\`, \`accept-edits\`, \`plan\`, or \`default\`.`);
          return true;
        }
        store.upsert(channel, threadTs, { mode: arg as AgyMode });
        await reply(`:white_check_mark: Mode for this thread set to \`${arg}\`.`);
        return true;
      }

      default:
        return false;
    }
  }

  async function executePrompt(params: {
    client: WebClient;
    channel: string;
    threadTs: string;
    prompt: string;
  }): Promise<void> {
    const { client, channel, threadTs, prompt } = params;
    const sessionKey = makeSessionKey(channel, threadTs);

    if (activeRuns.has(sessionKey)) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: ":hourglass: Antigravity is still working on your previous message in this thread. Wait for it to finish or send `!cancel`.",
      });
      return;
    }

    const session = store.upsert(channel, threadTs, {});
    const controller = new AbortController();
    activeRuns.set(sessionKey, controller);

    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Antigravity is thinking...",
      blocks: buildStreamingBlocks("", sessionKey) as never,
    });

    const placeholderTs = placeholder.ts;
    let latestText = "";
    let latestStatus: string | undefined;
    let dirty = false;
    let updating = false;
    let finished = false;
    let timer: NodeJS.Timeout | undefined;

    const flushStreamUpdate = async (): Promise<void> => {
      if (finished || updating || !dirty || !placeholderTs) return;
      dirty = false;
      updating = true;
      try {
        await client.chat.update({
          channel,
          ts: placeholderTs,
          text: latestText.trim() || "Antigravity is thinking...",
          blocks: buildStreamingBlocks(latestText, sessionKey, latestStatus) as never,
        });
      } catch (err) {
        logger.debug("Stream chat.update skipped", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        updating = false;
        if (!finished && dirty) {
          scheduleUpdate();
        }
      }
    };

    const scheduleUpdate = (): void => {
      if (finished || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void flushStreamUpdate();
      }, config.streamUpdateIntervalMs);
    };

    try {
      const result = await runner.run({
        prompt,
        conversationId: session.conversationId,
        model: session.model,
        mode: session.mode,
        signal: controller.signal,
        onConversationId: (conversationId) => {
          store.upsert(channel, threadTs, { conversationId });
        },
        onTextDelta: (_delta, accumulated) => {
          latestText = accumulated;
          dirty = true;
          scheduleUpdate();
        },
        onStatus: (statusText) => {
          latestStatus = statusText;
          dirty = true;
          scheduleUpdate();
        },
      });

      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (result.conversationId) {
        store.upsert(channel, threadTs, { conversationId: result.conversationId });
      }

      let bodyText: string;
      if (result.aborted) {
        bodyText = latestText.trim()
          ? `${markdownToSlackMrkdwn(latestText)}\n\n:octagonal_sign: _Cancelled by user._`
          : ":octagonal_sign: _Cancelled by user._";
      } else if (result.response) {
        bodyText = markdownToSlackMrkdwn(result.response) + formatFooter(result);
      } else if (result.exitCode !== 0 && result.stderr) {
        bodyText = `:x: *Antigravity CLI exited with code ${result.exitCode}*\n\`\`\`\n${result.stderr.slice(0, 2500)}\n\`\`\``;
      } else {
        bodyText = "_(Antigravity returned an empty response)_" + formatFooter(result);
      }

      const chunks = splitSlackMessage(bodyText);

      if (placeholderTs) {
        await client.chat.update({
          channel,
          ts: placeholderTs,
          text: chunks[0],
          blocks: [],
        });
      } else {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: chunks[0],
        });
      }

      for (let i = 1; i < chunks.length; i++) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: chunks[i],
        });
      }
    } catch (err) {
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed executing agy prompt", { channel, threadTs, error: message });

      const errorText = `:x: *Failed to run Antigravity CLI*\n\`${message}\``;
      if (placeholderTs) {
        await client.chat.update({
          channel,
          ts: placeholderTs,
          text: errorText,
          blocks: [],
        });
      } else {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: errorText,
        });
      }
    } finally {
      activeRuns.delete(sessionKey);
    }
  }

  async function processIncomingMessage(params: {
    client: WebClient;
    channel: string;
    ts: string;
    threadTs?: string;
    user?: string;
    text?: string;
  }): Promise<void> {
    const { client, channel, ts, threadTs, user, text } = params;
    if (!markProcessed(channel, ts)) return;

    const replyThreadTs = threadTs ?? ts;

    const authCheck = checkAuthorization(user, channel);
    if (!authCheck.allowed) {
      logger.warn("Blocked unauthorized Slack message", {
        user,
        channel,
        reason: authCheck.reason,
      });
      try {
        await client.chat.postMessage({
          channel,
          thread_ts: replyThreadTs,
          text: ":lock: You are not authorized to use this Antigravity CLI bridge.",
        });
      } catch (err) {
        logger.debug("Could not send unauthorized notice to Slack channel", {
          channel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    const cleaned = stripBotMention(text ?? "");
    if (!cleaned) {
      await client.chat.postMessage({
        channel,
        thread_ts: replyThreadTs,
        text: "Hi! Send me a prompt or type `!help` to see available commands.",
      });
      return;
    }

    const handled = await handleCommand(client, channel, replyThreadTs, cleaned);
    if (handled) return;

    await executePrompt({
      client,
      channel,
      threadTs: replyThreadTs,
      prompt: cleaned,
    });
  }

  // 1. Channel @mentions
  app.event("app_mention", async ({ event, client }) => {
    await processIncomingMessage({
      client,
      channel: event.channel,
      ts: event.ts,
      threadTs: event.thread_ts,
      user: event.user,
      text: event.text,
    });
  });

  // 2. Direct messages & follow-up replies inside tracked threads
  app.event("message", async ({ event, client }) => {
    const msg = event as {
      subtype?: string;
      bot_id?: string;
      channel: string;
      channel_type?: string;
      ts: string;
      thread_ts?: string;
      user?: string;
      text?: string;
    };

    if (msg.bot_id || msg.subtype) return;

    const isDm = msg.channel_type === "im";
    const isTrackedThread = Boolean(msg.thread_ts && store.has(msg.channel, msg.thread_ts));

    if (!isDm && !isTrackedThread) {
      return;
    }

    // In channels, @mentions are also delivered to app_mention; avoid double-handling
    if (!isDm && msg.text && msg.text.includes(`<@${botUserId}>`)) {
      return;
    }

    await processIncomingMessage({
      client,
      channel: msg.channel,
      ts: msg.ts,
      threadTs: msg.thread_ts,
      user: msg.user,
      text: msg.text,
    });
  });

  // 3. Cancel button interaction
  app.action("agy_cancel_run", async ({ ack, body, respond }) => {
    await ack();
    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const sessionKey = action?.value;
    if (!sessionKey) return;

    const controller = activeRuns.get(sessionKey);
    if (controller) {
      controller.abort();
    } else if (respond) {
      await respond({
        response_type: "ephemeral",
        replace_original: false,
        text: "This task is no longer running.",
      });
    }
  });

  // 4. /agy slash command
  app.command("/agy", async ({ command, ack, respond, client }) => {
    await ack();

    const authCheck = checkAuthorization(command.user_id, command.channel_id);
    if (!authCheck.allowed) {
      logger.warn("Blocked unauthorized /agy command", {
        user: command.user_id,
        channel: command.channel_id,
        reason: authCheck.reason,
      });
      await respond({
        response_type: "ephemeral",
        text: ":lock: You are not authorized to use this Antigravity CLI bridge.",
      });
      return;
    }

    const input = command.text.trim();
    if (!input || input.toLowerCase() === "help") {
      await respond({ response_type: "ephemeral", text: HELP_TEXT });
      return;
    }

    if (input.toLowerCase() === "status") {
      await respond({
        response_type: "ephemeral",
        text: [
          "*Antigravity CLI Bridge Status*",
          `• Active runs: ${activeRuns.size}`,
          `• Tracked threads: ${store.count()}`,
          `• Default model: \`${config.agyModel ?? "(default)"}\``,
          `• Default mode: \`${config.agyMode ?? "(default)"}\``,
          `• Workdir: \`${config.agyWorkdir}\``,
        ].join("\n"),
      });
      return;
    }

    // Post a starter message in the channel and run the prompt inside its thread
    const starter = await client.chat.postMessage({
      channel: command.channel_id,
      text: `<@${command.user_id}> asked Antigravity:\n> ${input}`,
    });

    if (starter.ts) {
      void executePrompt({
        client,
        channel: command.channel_id,
        threadTs: starter.ts,
        prompt: input,
      });
    }
  });

  return {
    cancelAll() {
      for (const controller of activeRuns.values()) {
        controller.abort();
      }
      activeRuns.clear();
    },
    size() {
      return activeRuns.size;
    },
  };
}
