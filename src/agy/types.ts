import type { AgyEffort, AgyMode } from "../config.js";

export interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

export interface AgyInitEvent {
  event: "init";
  conversation_id?: string;
  init?: {
    cwd?: string;
    tools?: string[];
    permission_mode?: string;
  };
}

export interface AgyStepUpdatePayload {
  conversation_id?: string;
  step_index?: number;
  state?: string;
  step_type?: string;
  text_delta?: string;
  thinking_delta?: string;
  tool_name?: string;
  duration_seconds?: number;
  usage?: AgyUsage;
  error?: string;
}

export interface AgyStepUpdateEvent {
  event: "step_update";
  step_update?: AgyStepUpdatePayload;
}

export interface AgyResultPayload {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AgyUsage;
}

export interface AgyResultEvent {
  event: "result";
  result?: AgyResultPayload;
}

export interface AgyUnknownEvent {
  event: string;
  [key: string]: unknown;
}

export type AgyStreamEvent =
  | AgyInitEvent
  | AgyStepUpdateEvent
  | AgyResultEvent
  | AgyUnknownEvent;

export interface AgyRunOptions {
  prompt: string;
  conversationId?: string;
  cwd?: string;
  model?: string;
  mode?: AgyMode;
  effort?: AgyEffort;
  sandbox?: boolean;
  dangerouslySkipPermissions?: boolean;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  onConversationId?: (conversationId: string) => void;
  onTextDelta?: (delta: string, accumulated: string) => void;
  onStatus?: (statusText: string) => void;
}

export interface AgyRunResult {
  conversationId?: string;
  response: string;
  status: string;
  durationSeconds?: number;
  numTurns?: number;
  usage?: AgyUsage;
  aborted: boolean;
  exitCode: number | null;
  stderr: string;
}
