import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  ProtocolValidationError,
  isErrorResponse,
  isHealthResponse,
  isMessageSuccessResponse,
  parseMessageRequest,
  parseResetRequest,
} from "./protocol.js";

const conversation = {
  platform: "onebot",
  selfId: "bot-1",
  channelId: "group-1",
  userId: "user-1",
  isDirect: false,
};

describe("protocol parsing", () => {
  it("detaches a valid message request", () => {
    const parsed = parseMessageRequest(
      {
        version: PROTOCOL_VERSION,
        requestId: "request-1",
        conversation,
        message: { text: "  hello  ", authorName: " Alice " },
        sentAt: 123,
      },
      20,
    );

    expect(parsed).toEqual({
      version: 1,
      requestId: "request-1",
      conversation,
      message: { text: "hello", authorName: "Alice" },
      sentAt: 123,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.conversation)).toBe(true);
  });

  it("rejects unknown fields and oversized text", () => {
    expect(() =>
      parseMessageRequest(
        {
          version: 1,
          requestId: "request-1",
          conversation,
          message: { text: "hello" },
          extra: true,
        },
        20,
      ),
    ).toThrow(ProtocolValidationError);

    expect(() =>
      parseMessageRequest(
        {
          version: 1,
          requestId: "request-1",
          conversation,
          message: { text: "too long" },
        },
        3,
      ),
    ).toThrow(/exceeds 3/);
  });

  it("rejects identifiers containing control characters", () => {
    expect(() =>
      parseResetRequest({
        version: 1,
        requestId: "request\n1",
        conversation,
      }),
    ).toThrow(/control characters/);
  });

  it("recognizes only complete response envelopes", () => {
    expect(
      isMessageSuccessResponse({
        ok: true,
        version: 1,
        requestId: "request-1",
        sessionId: "session-1",
        reply: "hello",
      }),
    ).toBe(true);
    expect(isMessageSuccessResponse({ ok: true, version: 1 })).toBe(false);
    expect(
      isErrorResponse({
        ok: false,
        version: 1,
        error: { code: "bad_request", message: "bad" },
      }),
    ).toBe(true);
    expect(
      isErrorResponse({
        ok: false,
        version: 1,
        error: { code: "made_up", message: "bad" },
      }),
    ).toBe(false);
    expect(
      isHealthResponse({
        ok: true,
        version: 1,
        service: "dsh-plugin-koishi",
        sessions: 0,
        activeSessions: 0,
        pendingTurns: 0,
      }),
    ).toBe(true);
  });
});
