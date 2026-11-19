import fs from "node:fs";
import path from "node:path";
import type { AgyMode } from "../config.js";

export interface ThreadSession {
  channel: string;
  threadTs: string;
  conversationId?: string;
  model?: string;
  mode?: AgyMode;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  version: 1;
  sessions: Record<string, ThreadSession>;
}

export function makeSessionKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

export class SessionStore {
  private sessions = new Map<string, ThreadSession>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      if (parsed && parsed.sessions && typeof parsed.sessions === "object") {
        for (const [key, value] of Object.entries(parsed.sessions)) {
          if (value && typeof value.channel === "string" && typeof value.threadTs === "string") {
            this.sessions.set(key, value);
          }
        }
      }
    } catch {
      // If file is corrupted, start fresh rather than crashing the bot
      this.sessions.clear();
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: StoreData = {
      version: 1,
      sessions: Object.fromEntries(this.sessions.entries()),
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }

  get(channel: string, threadTs: string): ThreadSession | undefined {
    return this.sessions.get(makeSessionKey(channel, threadTs));
  }

  has(channel: string, threadTs: string): boolean {
    return this.sessions.has(makeSessionKey(channel, threadTs));
  }

  upsert(
    channel: string,
    threadTs: string,
    patch: Partial<Pick<ThreadSession, "conversationId" | "model" | "mode">>
  ): ThreadSession {
    const key = makeSessionKey(channel, threadTs);
    const now = new Date().toISOString();
    const existing = this.sessions.get(key);

    const updated: ThreadSession = {
      channel,
      threadTs,
      conversationId:
        "conversationId" in patch ? patch.conversationId : existing?.conversationId,
      model: "model" in patch ? patch.model : existing?.model,
      mode: "mode" in patch ? patch.mode : existing?.mode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.sessions.set(key, updated);
    this.persist();
    return updated;
  }

  resetConversation(channel: string, threadTs: string): boolean {
    const key = makeSessionKey(channel, threadTs);
    const existing = this.sessions.get(key);
    if (!existing) return false;

    existing.conversationId = undefined;
    existing.updatedAt = new Date().toISOString();
    this.sessions.set(key, existing);
    this.persist();
    return true;
  }

  delete(channel: string, threadTs: string): boolean {
    const deleted = this.sessions.delete(makeSessionKey(channel, threadTs));
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  count(): number {
    return this.sessions.size;
  }
}
