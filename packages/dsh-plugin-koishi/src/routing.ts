import { createHash } from "node:crypto";

import type { ConversationRef, MessageRequest } from "./protocol.js";

export type SessionScope = "channel" | "user" | "channel-user";

export interface ChannelRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

/** Return whether a normalized conversation matches at least one explicit rule. */
export function matchesAllowedChannel(
  conversation: ConversationRef,
  rules: readonly ChannelRule[],
): boolean {
  return rules.some(
    (rule) =>
      (rule.platform === "*" || rule.platform === conversation.platform) &&
      (rule.channelId === "*" || rule.channelId === conversation.channelId) &&
      (rule.isDirect === undefined || rule.isDirect === conversation.isDirect),
  );
}

/** Build the stable, process-private routing key used by one conversation entry. */
export function conversationKey(
  conversation: ConversationRef,
  scope: SessionScope,
): string {
  switch (scope) {
    case "channel":
      return conversation.isDirect
        ? JSON.stringify([
            conversation.platform,
            conversation.selfId,
            "direct",
            conversation.channelId,
            conversation.userId,
          ])
        : JSON.stringify([
            conversation.platform,
            conversation.selfId,
            "channel",
            conversation.channelId,
          ]);
    case "user":
      return JSON.stringify([
        conversation.platform,
        conversation.selfId,
        "user",
        conversation.userId,
      ]);
    case "channel-user":
      return JSON.stringify([
        conversation.platform,
        conversation.selfId,
        conversation.isDirect ? "direct-user" : "channel-user",
        conversation.channelId,
        conversation.userId,
      ]);
  }
}

/** Derive an opaque Harness Session id without exposing any platform identifier. */
export function deriveSessionId(
  runtimeId: string,
  key: string,
  generation: number,
): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `koishi-${runtimeId}-${digest}-${generation}`;
}

/** Create a short, non-reversible route label suitable for diagnostics. */
export function routeFingerprint(conversation: ConversationRef): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        conversation.platform,
        conversation.selfId,
        conversation.channelId,
        conversation.userId,
        conversation.isDirect,
      ]),
    )
    .digest("hex")
    .slice(0, 12);
}

/** Format the exact model-visible prompt logged to the Harness Session. */
export function formatPrompt(
  request: MessageRequest,
  includeSenderInGroups: boolean,
): string {
  if (request.conversation.isDirect || !includeSenderInGroups)
    return request.message.text;
  const author = sanitizeAuthorName(request.message.authorName) ?? "unknown";
  return `[Koishi sender ${JSON.stringify(author)}]\n${request.message.text}`;
}

function sanitizeAuthorName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const compact = value.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
  return compact.length === 0 ? undefined : compact.slice(0, 80);
}
