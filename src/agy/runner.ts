import { spawn, type ChildProcess } from "node:child_process";
import type { AppConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";
import { NdjsonLineSplitter, parseAgyStreamLine } from "./parser.js";
import type { AgyRunOptions, AgyRunResult, AgyStreamEvent, AgyUsage } from "./types.js";

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
    } catch {
      child.kill();
    }
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore if already exited
    }
  }
}

export function buildAgyArgs(config: AppConfig, options: AgyRunOptions): string[] {
  const args: string[] = [
    "--print",
    options.prompt,
    "--output-format",
    "stream-json",
  ];

  if (options.conversationId) {
    args.push("--conversation", options.conversationId);
  }

  const model = options.model ?? config.agyModel;
  if (model) {
    args.push("--model", model);
  }

  const mode = options.mode ?? config.agyMode;
  if (mode) {
    args.push("--mode", mode);
  }

  const effort = options.effort ?? config.agyEffort;
  if (effort) {
    args.push("--effort", effort);
  }

  const sandbox = options.sandbox ?? config.agySandbox;
  if (sandbox) {
    args.push("--sandbox");
  }

  const skipPermissions =
    options.dangerouslySkipPermissions ?? config.agyDangerouslySkipPermissions;
  if (skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  const timeoutSeconds = options.timeoutSeconds ?? config.agyTimeoutSeconds;
  if (timeoutSeconds > 0) {
    args.push("--print-timeout", `${timeoutSeconds}s`);
  }

  return args;
}

const TRANSIENT_STARTUP_ERROR_RE =
  /Eligibility check failed:.*(?:EOF|unexpected EOF|connection reset|TLS handshake timeout|i\/o timeout|proxyconnect|bad gateway|service unavailable)/i;

const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

export function isTransientStartupError(result: AgyRunResult): boolean {
  if (result.aborted) return false;
  if (result.exitCode === 0 && result.status !== "ERROR") return false;
  if (result.numTurns && result.numTurns > 0) return false;
  const combined = `${result.stderr}\n${result.response}`;
  return TRANSIENT_STARTUP_ERROR_RE.test(combined);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AgyRunner {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async run(options: AgyRunOptions): Promise<AgyRunResult> {
    let attempt = 0;
    while (true) {
      const result = await this.runOnce(options);
      if (!isTransientStartupError(result) || attempt >= MAX_TRANSIENT_RETRIES) {
        return result;
      }

      attempt += 1;
      const delayMs = RETRY_BASE_DELAY_MS * attempt;
      this.logger.warn("Transient agy startup error, retrying", {
        attempt,
        maxRetries: MAX_TRANSIENT_RETRIES,
        delayMs,
        exitCode: result.exitCode,
        error: (result.stderr || result.response).slice(0, 300),
      });
      options.onStatus?.(
        `Transient connection error, retrying (${attempt}/${MAX_TRANSIENT_RETRIES})...`
      );

      const shouldContinue = await abortableDelay(delayMs, options.signal);
      if (!shouldContinue) {
        return { ...result, aborted: true, status: "CANCELLED" };
      }
    }
  }

  private async runOnce(options: AgyRunOptions): Promise<AgyRunResult> {
    const args = buildAgyArgs(this.config, options);
    const cwd = options.cwd ?? this.config.agyWorkdir;
    const useShell =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(this.config.agyBin);

    this.logger.info("Spawning agy CLI", {
      bin: this.config.agyBin,
      cwd,
      resuming: Boolean(options.conversationId),
      conversationId: options.conversationId,
    });

    return new Promise<AgyRunResult>((resolve, reject) => {
      const child = spawn(this.config.agyBin, args, {
        cwd,
        shell: useShell,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      });

      const splitter = new NdjsonLineSplitter();
      let stderr = "";
      let accumulatedText = "";
      let finalResponse: string | undefined;
      let conversationId: string | undefined = options.conversationId;
      let status = "UNKNOWN";
      let durationSeconds: number | undefined;
      let numTurns: number | undefined;
      let usage: AgyUsage | undefined;
      let aborted = false;

      const handleEvent = (event: AgyStreamEvent): void => {
        if (event.event === "init") {
          const cid = event.conversation_id;
          if (typeof cid === "string" && cid) {
            conversationId = cid;
            options.onConversationId?.(cid);
          }
          return;
        }

        if (event.event === "step_update" && event.step_update && typeof event.step_update === "object") {
          const update = event.step_update as {
            conversation_id?: string;
            step_type?: string;
            state?: string;
            text_delta?: string;
            tool_name?: string;
          };

          if (update.conversation_id && !conversationId) {
            conversationId = update.conversation_id;
            options.onConversationId?.(update.conversation_id);
          }

          if (typeof update.text_delta === "string" && update.text_delta.length > 0) {
            accumulatedText += update.text_delta;
            options.onTextDelta?.(update.text_delta, accumulatedText);
          } else if (update.step_type && update.step_type !== "user_input" && update.step_type !== "agent_response") {
            const label = update.tool_name
              ? `Running tool: \`${update.tool_name}\``
              : `Step: \`${update.step_type}\``;
            options.onStatus?.(label);
          }
          return;
        }

        if (event.event === "result" && event.result && typeof event.result === "object") {
          const res = event.result as {
            conversation_id?: string;
            status?: string;
            response?: string;
            error?: string;
            duration_seconds?: number;
            num_turns?: number;
            usage?: AgyUsage;
          };

          if (res.conversation_id) {
            conversationId = res.conversation_id;
            options.onConversationId?.(res.conversation_id);
          }
          if (res.status) status = res.status;
          if (typeof res.response === "string") finalResponse = res.response;
          if (typeof res.duration_seconds === "number") durationSeconds = res.duration_seconds;
          if (typeof res.num_turns === "number") numTurns = res.num_turns;
          if (res.usage) usage = res.usage;
          if (res.error && !finalResponse) {
            finalResponse = `Error: ${res.error}`;
          }
        }
      };

      const onAbort = (): void => {
        aborted = true;
        this.logger.warn("Aborting agy CLI process", { pid: child.pid, conversationId });
        killProcessTree(child);
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        for (const line of splitter.push(chunk)) {
          const evt = parseAgyStreamLine(line);
          if (evt) {
            handleEvent(evt);
          } else if (line.trim()) {
            this.logger.debug("agy non-JSON stdout line", { line: line.trim() });
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        options.signal?.removeEventListener("abort", onAbort);
        reject(new Error(`Failed to spawn "${this.config.agyBin}": ${err.message}`));
      });

      child.on("close", (exitCode) => {
        options.signal?.removeEventListener("abort", onAbort);

        for (const line of splitter.flush()) {
          const evt = parseAgyStreamLine(line);
          if (evt) handleEvent(evt);
        }

        const response = (finalResponse ?? accumulatedText).trim();
        if (status === "UNKNOWN") {
          status = aborted ? "CANCELLED" : exitCode === 0 ? "SUCCESS" : "ERROR";
        }

        this.logger.info("agy CLI finished", {
          exitCode,
          status,
          aborted,
          conversationId,
          durationSeconds,
          responseLength: response.length,
        });

        resolve({
          conversationId,
          response,
          status,
          durationSeconds,
          numTurns,
          usage,
          aborted,
          exitCode,
          stderr: stderr.trim(),
        });
      });
    });
  }
}
