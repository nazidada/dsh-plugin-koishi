import { createRequire } from "node:module";

import type { Context, Next, Session } from "koishi";
import { afterEach, describe, expect, it } from "vitest";

import type { MessageRequest, ResetRequest } from "dsh-plugin-koishi/protocol";

import type { FetchLike } from "./client.js";
import { DshBridgeService } from "./service.js";

const token = "service-token-".padEnd(64, "x");
const contexts: Context[] = [];
const { Context: RuntimeContext } = createRequire(import.meta.url)(
  "koishi",
) as {
  Context: new () => Context;
};

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map((ctx) => ctx.stop()));
});

describe("DshBridgeService", () => {
  it("checks health on start and handles forward, empty, reject, and skip paths", async () => {
    let messageReply = "  answer  ";
    const calls: URL[] = [];
    const service = createService(async (input, init) => {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname === "/healthz") return Response.json(healthResponse());
      const request = JSON.parse(String(init.body)) as MessageRequest;
      return Response.json({
        ok: true,
        version: 1,
        requestId: request.requestId,
        sessionId: "session-1",
        reply: messageReply,
      });
    });
    const ctx = service.ctx;

    await ctx.start();
    expect(calls.map((url) => url.pathname)).toEqual(["/healthz"]);
    await expect(service.instance.health()).resolves.toEqual(healthResponse());

    const middleware = lastMiddleware(ctx);
    await expect(middleware(session(), nextFailure)).resolves.toBe("answer");
    messageReply = "   ";
    await expect(middleware(session(), nextFailure)).resolves.toBe(
      "Harness 没有返回可发送的文本。",
    );
    await expect(
      middleware(session({ text: "x".repeat(33) }), nextFailure),
    ).resolves.toBe("消息过长，当前最多接受 32 个字符。");

    let nextCalls = 0;
    await expect(
      middleware(session({ channelId: "denied" }), async () => {
        nextCalls += 1;
      }),
    ).resolves.toBeUndefined();
    expect(nextCalls).toBe(1);
  });

  it("maps middleware errors and implements every reset command outcome", async () => {
    let status = 429;
    const service = createService(async (input, init) => {
      const url = new URL(input);
      const request = JSON.parse(String(init.body)) as
        MessageRequest | ResetRequest;
      if (status !== 200) return gatewayError(status);
      if (url.pathname.endsWith("/reset")) {
        return Response.json({
          ok: true,
          version: 1,
          requestId: request.requestId,
          sessionId: "session-2",
          reset: true,
        });
      }
      return Response.json({
        ok: true,
        version: 1,
        requestId: request.requestId,
        sessionId: "session-1",
        reply: "answer",
      });
    });
    const middleware = lastMiddleware(service.ctx);

    await expect(middleware(session(), nextFailure)).resolves.toBe(
      "Harness 当前排队已满，请稍后再试。",
    );
    status = 504;
    await expect(middleware(session(), nextFailure)).resolves.toBe(
      "Harness 本轮处理超时，请稍后再试。",
    );
    status = 500;
    await expect(middleware(session(), nextFailure)).resolves.toBe(
      "Harness 网关暂时不可用，请稍后再试。",
    );

    const action = resetAction(service.ctx);
    await expect(action({})).resolves.toBe("当前没有可重置的会话。");
    await expect(
      action({ session: session({ channelId: "denied" }) }),
    ).resolves.toBe("当前频道未启用 Harness 网关。");
    status = 200;
    await expect(action({ session: session() })).resolves.toBe(
      "Harness 会话已重置。",
    );
    status = 500;
    await expect(action({ session: session() })).resolves.toBe(
      "Harness 网关暂时不可用，请稍后再试。",
    );
  });
});

function createService(
  responder: (input: string | URL, init: RequestInit) => Promise<Response>,
): { ctx: Context; instance: DshBridgeService } {
  const ctx = new RuntimeContext();
  contexts.push(ctx);
  const fetchImpl = ((input: string | URL, init?: RequestInit) =>
    responder(input, init ?? {})) as FetchLike;
  const instance = new DshBridgeService(
    ctx,
    {
      token,
      eagerCheck: true,
      maxInputChars: 32,
      allowedChannels: [
        { platform: "onebot", channelId: "private-1", isDirect: true },
      ],
    },
    fetchImpl,
  );
  return { ctx, instance };
}

function lastMiddleware(
  ctx: Context,
): (session: Session, next: Next) => Promise<void | string> {
  const processor = ctx.$processor as unknown as {
    readonly _hooks: Array<{
      readonly callback: (
        session: Session,
        next: Next,
      ) => Promise<void | string>;
    }>;
  };
  const hook = processor._hooks.at(-1);
  if (hook === undefined)
    throw new Error("bridge middleware was not installed");
  return hook.callback;
}

function resetAction(
  ctx: Context,
): (argv: { session?: Session }) => Promise<string> {
  const commander = ctx.$commander as unknown as {
    get(name: string):
      | {
          readonly _actions: Array<
            (argv: { session?: Session }) => Promise<string> | string
          >;
        }
      | undefined;
  };
  const action = commander.get("dsh.reset")?._actions[0];
  if (action === undefined) throw new Error("reset command was not installed");
  return async (argv) => await action(argv);
}

function session(
  options: { readonly channelId?: string; readonly text?: string } = {},
): Session {
  return {
    argv: undefined,
    platform: "onebot",
    selfId: "bot-1",
    channelId: options.channelId ?? "private-1",
    userId: "user-1",
    isDirect: true,
    messageId: "message-1",
    timestamp: 123,
    username: "Alice",
    stripped: {
      content: options.text ?? "hello",
      appel: false,
      atSelf: false,
      hasAt: false,
      prefix: "",
    },
  } as unknown as Session;
}

function healthResponse(): object {
  return {
    ok: true,
    version: 1,
    service: "dsh-plugin-koishi",
    sessions: 0,
    activeSessions: 0,
    pendingTurns: 0,
  };
}

function gatewayError(status: number): Response {
  const code =
    status === 429
      ? "gateway_busy"
      : status === 504
        ? "turn_timeout"
        : "internal_error";
  return Response.json(
    { ok: false, version: 1, error: { code, message: code } },
    { status },
  );
}

async function nextFailure(): Promise<never> {
  throw new Error("next must not be called");
}
