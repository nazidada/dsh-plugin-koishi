import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HealthResponse,
  MessageRequest,
  ResetRequest,
} from "dsh-plugin-koishi/protocol";

import { resolveConfig } from "./config.js";
import {
  DshBridgeBusyError,
  DshBridgeHttpError,
  DshBridgeProtocolError,
  DshBridgeTimeoutError,
  DshGatewayClient,
  type FetchLike,
} from "./client.js";

const token = "client-token-".padEnd(64, "x");

afterEach(() => {
  vi.useRealTimers();
});

describe("DshGatewayClient", () => {
  it("validates successful message, reset, and health envelopes", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const client = createClient(async (input, init) => {
      const url = new URL(input);
      calls.push({ url, init });
      if (url.pathname === "/healthz") return json(healthResponse());
      const request = JSON.parse(String(init.body)) as
        MessageRequest | ResetRequest;
      if (url.pathname.endsWith("/reset")) {
        return json({
          ok: true,
          version: 1,
          requestId: request.requestId,
          sessionId: "session-2",
          reset: true,
        });
      }
      return json({
        ok: true,
        version: 1,
        requestId: request.requestId,
        sessionId: "session-1",
        reply: "answer",
      });
    });

    await expect(client.send(messageRequest())).resolves.toBe("answer");
    await expect(client.reset(resetRequest())).resolves.toBeUndefined();
    await expect(client.health()).resolves.toEqual(healthResponse());
    expect(calls.map(({ init }) => init.method)).toEqual([
      "POST",
      "POST",
      "GET",
    ]);
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    });
    expect(calls.every(({ init }) => init.redirect === "error")).toBe(true);
  });

  it("rejects mismatched or malformed success envelopes", async () => {
    const responses = [
      json({
        ok: true,
        version: 1,
        requestId: "different",
        sessionId: "session",
        reply: "answer",
      }),
      json({ ok: true, version: 1 }),
      json({ ok: true, version: 1, service: "wrong" }),
    ];
    const client = createClient(async () => responses.shift()!);

    await expect(client.send(messageRequest())).rejects.toBeInstanceOf(
      DshBridgeProtocolError,
    );
    await expect(client.reset(resetRequest())).rejects.toBeInstanceOf(
      DshBridgeProtocolError,
    );
    await expect(client.health()).rejects.toBeInstanceOf(
      DshBridgeProtocolError,
    );
  });

  it("rejects non-JSON and oversized gateway responses", async () => {
    const responses = [
      new Response("not-json"),
      new Response("x".repeat(64 * 1024 + 1)),
      new Response("{}", {
        headers: { "content-length": String(64 * 1024 + 1) },
      }),
    ];
    const client = createClient(async () => responses.shift()!);

    await expect(client.health()).rejects.toThrow(/non-JSON/);
    await expect(client.health()).rejects.toThrow(/exceeds 64 KiB/);
    await expect(client.health()).rejects.toThrow(/exceeds 64 KiB/);
  });

  it("maps retryable and generic HTTP errors", async () => {
    const responses = [
      errorResponse(429, "gateway_busy"),
      errorResponse(504, "turn_timeout"),
      errorResponse(500, "internal_error"),
      new Response("{}", { status: 502 }),
    ];
    const client = createClient(async () => responses.shift()!);

    await expect(client.health()).rejects.toBeInstanceOf(DshBridgeBusyError);
    await expect(client.health()).rejects.toBeInstanceOf(DshBridgeTimeoutError);
    await expect(client.health()).rejects.toMatchObject({
      name: "DshBridgeHttpError",
      status: 500,
      code: "internal_error",
    });
    await expect(client.health()).rejects.toMatchObject({
      name: "DshBridgeHttpError",
      status: 502,
      code: "invalid_error_response",
    });
  });

  it("aborts a request when the local timeout expires", async () => {
    vi.useFakeTimers();
    const client = createClient(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      1000,
    );

    const pending = client.health();
    const expected = expect(pending).rejects.toBeInstanceOf(
      DshBridgeTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expected;
  });

  it("preserves network failures that happen before the timeout", async () => {
    const failure = new TypeError("connection refused");
    const client = createClient(async () => {
      throw failure;
    });

    await expect(client.health()).rejects.toBe(failure);
    expect(new DshBridgeHttpError(418, "teapot").message).toContain("418");
  });
});

function createClient(
  responder: (input: string | URL, init: RequestInit) => Promise<Response>,
  requestTimeoutMs = 1000,
): DshGatewayClient {
  const fetchImpl = ((input: string | URL, init?: RequestInit) =>
    responder(input, init ?? {})) as FetchLike;
  return new DshGatewayClient(
    resolveConfig(
      {
        token,
        requestTimeoutMs,
        eagerCheck: false,
        allowedChannels: [{ platform: "*", channelId: "*" }],
      },
      {},
    ),
    fetchImpl,
  );
}

function messageRequest(): MessageRequest {
  return {
    version: 1,
    requestId: "message-1",
    conversation: {
      platform: "test",
      selfId: "bot",
      channelId: "channel",
      userId: "user",
      isDirect: true,
    },
    message: { text: "hello" },
  };
}

function resetRequest(): ResetRequest {
  return {
    version: 1,
    requestId: "reset-1",
    conversation: messageRequest().conversation,
  };
}

function healthResponse(): HealthResponse {
  return {
    ok: true,
    version: 1,
    service: "dsh-plugin-koishi",
    sessions: 0,
    activeSessions: 0,
    pendingTurns: 0,
  };
}

function json(value: unknown): Response {
  return Response.json(value);
}

function errorResponse(status: number, code: string): Response {
  return Response.json(
    {
      ok: false,
      version: 1,
      error: { code, message: code },
    },
    { status },
  );
}
