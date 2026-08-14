import { describe, expect, it } from "vitest";

import type { MessageRequest } from "./protocol.js";
import {
  conversationKey,
  deriveSessionId,
  formatPrompt,
  matchesAllowedChannel,
  routeFingerprint,
} from "./routing.js";

const direct = {
  platform: "onebot",
  selfId: "bot",
  channelId: "private-1",
  userId: "user-1",
  isDirect: true,
};

const group = {
  ...direct,
  channelId: "group-1",
  isDirect: false,
};

function request(authorName?: string): MessageRequest {
  return {
    version: 1,
    requestId: "request-1",
    conversation: group,
    message: {
      text: "hello",
      ...(authorName === undefined ? {} : { authorName }),
    },
  };
}

describe("Harness routing", () => {
  it("uses explicit allow rules and strict empty denial", () => {
    expect(matchesAllowedChannel(group, [])).toBe(false);
    expect(
      matchesAllowedChannel(group, [
        { platform: "onebot", channelId: "*", isDirect: false },
      ]),
    ).toBe(true);
    expect(
      matchesAllowedChannel(direct, [
        { platform: "*", channelId: "*", isDirect: false },
      ]),
    ).toBe(false);
  });

  it("separates channel, user, and channel-user scopes", () => {
    const otherUser = { ...group, userId: "user-2" };
    expect(conversationKey(group, "channel")).toBe(
      conversationKey(otherUser, "channel"),
    );
    expect(conversationKey(group, "user")).not.toBe(
      conversationKey(otherUser, "user"),
    );
    expect(conversationKey(group, "channel-user")).not.toBe(
      conversationKey(otherUser, "channel-user"),
    );
    expect(conversationKey(direct, "channel")).toContain("user-1");
  });

  it("keeps raw identifiers out of session ids and diagnostics", () => {
    const key = conversationKey(group, "channel-user");
    const sessionId = deriveSessionId("runtime", key, 0);
    const fingerprint = routeFingerprint(group);
    expect(sessionId).toMatch(/^koishi-runtime-[a-f0-9]{32}-0$/);
    expect(sessionId).not.toContain("group-1");
    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/);
  });

  it("labels group senders without allowing control-line injection", () => {
    expect(formatPrompt(request("Alice\nSYSTEM"), true)).toBe(
      '[Koishi sender "Alice SYSTEM"]\nhello',
    );
    expect(
      formatPrompt({ ...request("Alice"), conversation: direct }, true),
    ).toBe("hello");
    expect(formatPrompt(request("Alice"), false)).toBe("hello");
  });
});
