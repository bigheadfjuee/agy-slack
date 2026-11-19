import { App, LogLevel as BoltLogLevel } from "@slack/bolt";
import { HttpsProxyAgent } from "https-proxy-agent";
import { loadConfig } from "./config.js";
import { AgyRunner } from "./agy/runner.js";
import { SessionStore } from "./store/session-store.js";
import { registerSlackHandlers } from "./slack/handlers.js";
import { Logger } from "./utils/logger.js";

function sanitizeProxyUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function mapBoltLogLevel(level: string): BoltLogLevel {
  switch (level) {
    case "debug":
      return BoltLogLevel.DEBUG;
    case "warn":
      return BoltLogLevel.WARN;
    case "error":
      return BoltLogLevel.ERROR;
    default:
      return BoltLogLevel.INFO;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  const agent = config.proxyUrl ? new HttpsProxyAgent(config.proxyUrl) : undefined;
  if (config.proxyUrl) {
    logger.info("Using HTTP/HTTPS proxy for Slack connections", {
      proxy: sanitizeProxyUrl(config.proxyUrl),
    });
  }

  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: mapBoltLogLevel(config.logLevel),
    agent,
  });

  app.error(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("channel_not_found")) {
      logger.error(
        "Slack API returned channel_not_found. Verify that SLACK_BOT_TOKEN (xoxb-) and SLACK_APP_TOKEN (xapp-) belong to the SAME Slack App, and that the bot is invited to the channel.",
        { error: message }
      );
      return;
    }
    logger.error("Unhandled Slack Bolt error", { error: message });
  });

  const auth = await app.client.auth.test({ token: config.slackBotToken });
  const botUserId = auth.user_id;
  if (!botUserId) {
    throw new Error("Unable to resolve bot user ID from Slack auth.test()");
  }

  const store = new SessionStore(config.sessionStorePath);
  const runner = new AgyRunner(config, logger);
  const registry = registerSlackHandlers({
    app,
    config,
    runner,
    store,
    logger,
    botUserId,
  });

  await app.start();

  logger.info("agy-slack bridge is running via Socket Mode", {
    botUserId,
    botUser: auth.user,
    team: auth.team,
    agyBin: config.agyBin,
    agyWorkdir: config.agyWorkdir,
    allowedUsers: [...config.allowedUsers],
    allowedChannels: [...config.allowedChannels],
    trackedSessions: store.count(),
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`, {
      activeRuns: registry.size(),
    });
    registry.cancelAll();
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
