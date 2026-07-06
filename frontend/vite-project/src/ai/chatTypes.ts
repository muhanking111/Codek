/*---------------------------------------------------------------------------------------------
 *  Codek Chat — rich message parts schema.
 *
 *  Replaces the legacy `{ role, content, toolUse? }` shape with an ordered `parts[]` array,
 *  enabling: text + multiple tool calls + thinking blocks interleaved in a single turn.
 *
 *  Compatibility: ChatPanel.vue renders `parts` if present, else falls back to legacy fields.
 *  Migration helper `migrateLegacyMessage` converts old → new on demand.
 *--------------------------------------------------------------------------------------------*/

export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ThinkingPart {
  type: 'thinking';
  text: string;
  /** True while the thinking block is still being streamed in. */
  streaming?: boolean;
}

export interface ToolCallPart {
  type: 'tool_call';
  /** Stable id produced by the model — must match the matching tool_result.callId. */
  id: string;
  name: string;
  input: unknown;
  status: ToolCallStatus;
  /** Optional human-readable preview (e.g. command text, file path) shown on the card header. */
  preview?: string;
  /** Set when status === 'error'. */
  errorMessage?: string;
}

export interface ToolResultPart {
  type: 'tool_result';
  callId: string;
  content: string;
  isError?: boolean;
  /** When the tool returned structured data, keep it for richer rendering (diff, table, …). */
  structured?: unknown;
}

export interface PlanPart {
  type: 'plan';
  plan: unknown;
}

export type ChatPart = TextPart | ThinkingPart | ToolCallPart | ToolResultPart | PlanPart;

export interface ChatMentionChip {
  type: string;
  icon: string;
  label: string;
}

/** Legacy shape, retained for backward compatibility with App.vue and existing sessions. */
export interface LegacyChatToolUse {
  name: string;
  status: string;
  result?: unknown;
  error?: unknown;
}

export interface RichChatMessage {
  role: 'user' | 'assistant' | 'system';
  /** Preferred rich representation. When set, ChatPanel renders this and ignores `content`. */
  parts?: ChatPart[];
  /** Legacy plain text. Still honoured when `parts` is absent. */
  content?: string;
  _streaming?: boolean;
  _mentions?: ChatMentionChip[];
  /** Legacy single-tool field. */
  toolUse?: LegacyChatToolUse;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a legacy message into a parts-based one. Pure function. */
export function migrateLegacyMessage(msg: RichChatMessage): RichChatMessage {
  if (msg.parts && msg.parts.length > 0) {
    return msg;
  }
  const parts: ChatPart[] = [];
  if (typeof msg.content === 'string' && msg.content.length > 0) {
    parts.push({ type: 'text', text: msg.content });
  }
  if (msg.toolUse) {
    const status = (msg.toolUse.status as ToolCallStatus) ?? 'done';
    const callId = `legacy_${Math.random().toString(36).slice(2, 10)}`;
    parts.push({
      type: 'tool_call',
      id: callId,
      name: msg.toolUse.name,
      input: undefined,
      status,
      errorMessage: msg.toolUse.error ? String(msg.toolUse.error) : undefined,
    });
    if (status === 'done' || status === 'error') {
      parts.push({
        type: 'tool_result',
        callId,
        content: status === 'error'
          ? String(msg.toolUse.error ?? '')
          : stringifyResult(msg.toolUse.result),
        isError: status === 'error',
        structured: msg.toolUse.result,
      });
    }
  }
  return { ...msg, parts };
}

/** Pull plain text out of any message (used for legacy code paths that still expect a string). */
export function partsToPlainText(parts: ChatPart[] | undefined): string {
  if (!parts) {
    return '';
  }
  let out = '';
  for (const p of parts) {
    if (p.type === 'text') {
      out += p.text;
    }
  }
  return out;
}

/** True iff this turn contains at least one tool call. */
export function hasToolActivity(msg: RichChatMessage): boolean {
  if (msg.toolUse) {
    return true;
  }
  return !!msg.parts?.some(p => p.type === 'tool_call' || p.type === 'tool_result');
}

function stringifyResult(v: unknown): string {
  if (v == null) {
    return '';
  }
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
