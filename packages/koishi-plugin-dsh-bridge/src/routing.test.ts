import type { Session } from "koishi";
import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.js";
import { prepareIncomingMessage, prepareResetRequest } from "./routing.js";

const token = "c".repeat(64);

describe("Koishi routing", () => {
  it("forwards direct messages from explicitly allowed channels", () => {
    const config = resolveConfig(
      {
        token,
        allowedChannels: [
          { platform: "onebot", channelId: "private-1", isDirect: true },
        ],
      },
      {},
    );
    const prepared = prepareIncomingMessage(session(), config);
    expect(prepared.kind).toBe("forward");
    if (prepared.kind !== "forward") return;
    expect(prepared.request.message).toEqual({
      text: "hello",
      authorName: "Alice",
    });
    expect(prepared.request.requestId).toMatch(/^koishi-[a-f0-9]{64}$/);
  });

  it("requires a mention for group messages in the default trigger mode", () => {
    const config = resolveConfig(
      {
        token,
        allowedChannels: [{ platform: "*", channelId: "*" }],
      },
      {},
    );
    expect(
      prepareIncomingMessage(
        session({ isDirect: false, appel: false }),
        config,
      ),
    ).toEqual({ kind: "skip" });
    expect(
      prepareIncomingMessage(session({ isDirect: false, appel: true }), config)
        .kind,
    ).toBe("forward");
  });

  it("denies every channel when the rule list is empty", () => {
    const config = resolveConfig({ token }, {});
    expect(prepareIncomingMessage(session(), config)).toEqual({ kind: "skip" });
    expect(prepareResetRequest(session(), [])).toBeUndefined();
  });

  it("rejects oversized input locally", () => {
    const config = resolveConfig(
      {
        token,
        maxInputChars: 3,
        allowedChannels: [{ platform: "*", channelId: "*" }],
      },
      {},
    );
    const prepared = prepareIncomingMessage(session({ text: "four" }), config);
    expect(prepared).toEqual({
      kind: "reject",
      reply: "消息过长，当前最多接受 3 个字符。",
    });
  });

  it("derives the same request id for a replayed platform message", () => {
    const config = resolveConfig(
      {
        token,
        allowedChannels: [{ platform: "*", channelId: "*" }],
      },
      {},
    );
    const first = prepareIncomingMessage(session(), config);
    const second = prepareIncomingMessage(session(), config);
    expect(first.kind).toBe("forward");
    expect(second.kind).toBe("forward");
    if (first.kind === "forward" && second.kind === "forward") {
      expect(first.request.requestId).toBe(second.request.requestId);
    }
  });

  it("skips incomplete, empty, command, and unmet mention inputs", () => {
    const config = resolveConfig(
      {
        token,
        trigger: "mention",
        allowedChannels: [{ platform: "*", channelId: "*" }],
      },
      {},
    );
    expect(
      prepareIncomingMessage(
        { ...session(), channelId: undefined } as unknown as Session,
        config,
      ),
    ).toEqual({ kind: "skip" });
    expect(
      prepareIncomingMessage(session({ text: "   ", appel: true }), config),
    ).toEqual({ kind: "skip" });
    expect(
      prepareIncomingMessage(
        {
          ...session({ appel: true }),
          argv: { command: {} },
        } as unknown as Session,
        config,
      ),
    ).toEqual({ kind: "skip" });
    expect(prepareIncomingMessage(session(), config)).toEqual({ kind: "skip" });

    const allConfig = resolveConfig(
      {
        token,
        trigger: "all",
        allowedChannels: [{ platform: "*", channelId: "*" }],
      },
      {},
    );
    const generated = prepareIncomingMessage(
      {
        ...session(),
        messageId: undefined,
        timestamp: -1,
        username: " ",
      } as unknown as Session,
      allConfig,
    );
    expect(generated.kind).toBe("forward");
    if (generated.kind === "forward") {
      expect(generated.request.requestId).toMatch(/^koishi-[0-9a-f-]{36}$/);
      expect(generated.request.message.authorName).toBeUndefined();
      expect(generated.request.sentAt).toBeUndefined();
    }
  });
});

function session(
  options: {
    readonly isDirect?: boolean;
    readonly appel?: boolean;
    readonly text?: string;
  } = {},
): Session {
  return {
    argv: undefined,
    platform: "onebot",
    selfId: "bot-1",
    channelId: options.isDirect === false ? "group-1" : "private-1",
    userId: "user-1",
    isDirect: options.isDirect ?? true,
    messageId: "message-1",
    timestamp: 123,
    username: "Alice",
    stripped: {
      content: options.text ?? "hello",
      appel: options.appel ?? false,
      atSelf: options.appel ?? false,
      hasAt: options.appel ?? false,
      prefix: "",
    },
  } as unknown as Session;
}
