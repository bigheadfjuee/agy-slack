import path from "node:path";
import dotenv from "dotenv";
import type { LogLevel } from "./utils/logger.js";

dotenv.config({ override: true });

export type AgyMode = "auto" | "accept-edits" | "plan";
export type AgyEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  proxyUrl?: string;
  allowedUsers: Set<string>;
  allowedChannels: Set<string>;
  agyBin: string;
  agyWorkdir: string;
  agyModel?: string;
  agyMode?: AgyMode;
  agyEffort?: AgyEffort;
  agySandbox: boolean;
  agyDangerouslySkipPermissions: boolean;
  agyTimeoutSeconds: number;
  sessionStorePath: string;
  streamUpdateIntervalMs: number;
  logLevel: LogLevel;
}

const VALID_MODES = new Set<AgyMode>(["auto", "accept-edits", "plan"]);
const VALID_EFFORTS = new Set<AgyEffort>(["low", "medium", "high", "xhigh", "max"]);
const VALID_LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

function parseCsvSet(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value || value.trim() === "") return defaultValue;
  const parsed = Number.parseInt(value.trim(), 10);
  if (Number.isNaN(parsed) || parsed < 0) return defaultValue;
  return parsed;
}

export function loadConfig(): AppConfig {
  const slackBotToken = process.env.SLACK_BOT_TOKEN?.trim();
  const slackAppToken = process.env.SLACK_APP_TOKEN?.trim();

  if (!slackBotToken) {
    throw new Error("Missing required environment variable: SLACK_BOT_TOKEN (starts with xoxb-)");
  }
  if (!slackAppToken) {
    throw new Error("Missing required environment variable: SLACK_APP_TOKEN (starts with xapp-)");
  }

  const rawMode = process.env.AGY_MODE?.trim() as AgyMode | undefined;
  if (rawMode && !VALID_MODES.has(rawMode)) {
    throw new Error(`Invalid AGY_MODE "${rawMode}". Expected one of: auto, accept-edits, plan`);
  }

  const rawEffort = process.env.AGY_EFFORT?.trim() as AgyEffort | undefined;
  if (rawEffort && !VALID_EFFORTS.has(rawEffort)) {
    throw new Error(`Invalid AGY_EFFORT "${rawEffort}". Expected one of: low, medium, high, xhigh, max`);
  }

  const rawLogLevel = (process.env.LOG_LEVEL?.trim().toLowerCase() || "info") as LogLevel;
  const logLevel: LogLevel = VALID_LOG_LEVELS.has(rawLogLevel) ? rawLogLevel : "info";

  const agyWorkdir = process.env.AGY_WORKDIR?.trim()
    ? path.resolve(process.env.AGY_WORKDIR.trim())
    : process.cwd();

  const sessionStorePath = path.resolve(
    process.env.SESSION_STORE_PATH?.trim() || "./data/sessions.json"
  );

  const explicitProxy = process.env.SLACK_PROXY_URL?.trim();
  const proxyUrl =
    explicitProxy && ["none", "false", "off"].includes(explicitProxy.toLowerCase())
      ? undefined
      : explicitProxy ||
        process.env.HTTPS_PROXY?.trim() ||
        process.env.https_proxy?.trim() ||
        process.env.HTTP_PROXY?.trim() ||
        process.env.http_proxy?.trim() ||
        undefined;

  return {
    slackBotToken,
    slackAppToken,
    proxyUrl,
    allowedUsers: parseCsvSet(process.env.SLACK_ALLOWED_USERS),
    allowedChannels: parseCsvSet(process.env.SLACK_ALLOWED_CHANNELS),
    agyBin: process.env.AGY_BIN?.trim() || "agy",
    agyWorkdir,
    agyModel: process.env.AGY_MODEL?.trim() || undefined,
    agyMode: rawMode || undefined,
    agyEffort: rawEffort || undefined,
    agySandbox: parseBool(process.env.AGY_SANDBOX, false),
    agyDangerouslySkipPermissions: parseBool(process.env.AGY_DANGEROUSLY_SKIP_PERMISSIONS, false),
    agyTimeoutSeconds: parsePositiveInt(process.env.AGY_TIMEOUT_SECONDS, 300),
    sessionStorePath,
    streamUpdateIntervalMs: Math.max(400, parsePositiveInt(process.env.STREAM_UPDATE_INTERVAL_MS, 1000)),
    logLevel,
  };
}
