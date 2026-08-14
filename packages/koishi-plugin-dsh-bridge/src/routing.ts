import { createHash, randomUUID } from "node:crypto";

import type { Session } from "koishi";

import {
  PROTOCOL_VERSION,
  type ConversationRef,
  type MessageRequest,
  type ResetRequest,
} from "dsh-plugin-koishi/protocol";

import type { ChannelRule, ResolvedConfig, TriggerMode } from "./config.js";

export type PreparedMessage =
  | { readonly kind: "skip" }
  | { readonly kind: "reject"; readonly reply: string }
  | { readonly kind: "forward"; readonly request: MessageRequest };

/** Convert a live Koishi Session into a detached wire request or a local decision. */
export function prepareIncomingMessage(
  session: Session,
  config: ResolvedConfig,
): PreparedMessage {
  if (session.argv?.command) return { kind: "skip" };
  const conversation = conversationFromSession(session);
  if (
    conversation === undefined ||
    !matchesAllowedChannel(conversation, config.allowedChannels)
  ) {
    return { kind: "skip" };
  }
  if (!matchesTrigger(session, config.trigger)) return { kind: "skip" };
  const text = session.stripped.content.trim();
  if (!text) return { kind: "skip" };
  if (text.length > config.maxInputChars) {
    return {
      kind: "reject",
      reply: config.inputTooLongReply.replace(
        "{limit}",
        String(config.maxInputChars),
      ),
    };
  }

  const authorName = session.username?.trim();
  const sentAt =
    Number.isSafeInteger(session.timestamp) && session.timestamp >= 0
      ? session.timestamp
      : undefined;
  return {
    kind: "forward",
    request: Object.freeze({
      version: PROTOCOL_VERSION,
      requestId: messageRequestId(session, conversation),
      conversation,
      message: Object.freeze({
        text,
        ...(authorName ? { authorName } : {}),
      }),
      ...(sentAt === undefined ? {} : { sentAt }),
    }),
  };
}

/** Convert a live Koishi Session into detached reset input when the route is allowed. */
export function prepareResetRequest(
  session: Session,
  rules: readonly ChannelRule[],
): ResetRequest | undefined {
  const conversation = conversationFromSession(session);
  if (conversation === undefined || !matchesAllowedChannel(conversation, rules))
    return undefined;
  return Object.freeze({
    version: PROTOCOL_VERSION,
    requestId: `reset-${randomUUID()}`,
    conversation,
  });
}

/** Match explicit channel rules; an empty list deliberately denies every route. */
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

/** Create a short route label that never reveals raw platform identifiers. */
export function routeFingerprint(conversation: ConversationRef): string {
  return createHash("sha256")
    .update(JSON.stringify(conversation))
    .digest("hex")
    .slice(0, 12);
}

function conversationFromSession(
  session: Session,
): ConversationRef | undefined {
  if (
    !session.platform ||
    !session.selfId ||
    !session.channelId ||
    !session.userId
  )
    return undefined;
  return Object.freeze({
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    userId: session.userId,
    isDirect: session.isDirect,
  });
}

function matchesTrigger(session: Session, trigger: TriggerMode): boolean {
  if (trigger === "all") return true;
  if (trigger === "mention") return session.stripped.appel;
  return session.isDirect || session.stripped.appel;
}

function messageRequestId(
  session: Session,
  conversation: ConversationRef,
): string {
  const messageId = session.messageId;
  if (!messageId) return `koishi-${randomUUID()}`;
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        conversation.platform,
        conversation.selfId,
        conversation.channelId,
        messageId,
      ]),
    )
    .digest("hex");
  return `koishi-${digest}`;
}
