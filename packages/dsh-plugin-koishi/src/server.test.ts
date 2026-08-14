import { afterEach, describe, expect, it } from "vitest";

import { GatewayBusyError } from "./errors.js";
import { PROTOCOL_VERSION, type MessageRequest } from "./protocol.js";
import { GatewayServer, type GatewayRuntime } from "./server.js";

const token = "test-token-".padEnd(64, "x");
const servers: GatewayServer[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

describe("GatewayServer", () => {
  it("authenticates health, message, and reset requests", async () => {
    const runtime: GatewayRuntime = {
      dispatch: async (request) => ({
        sessionId: "session-1",
        reply: request.message.text.toUpperCase(),
      }),
      reset: async () => ({ sessionId: "session-2", reset: true }),
      stats: () => ({ sessions: 1, activeSessions: 0, pendingTurns: 0 }),
    };
    const server = await start(runtime);

    const unauthorized = await fetch(`${server.address()}/healthz`);
    expect(unauthorized.status).toBe(401);

    const health = await authorizedFetch(`${server.address()}/healthz`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      service: "dsh-plugin-koishi",
      sessions: 1,
    });

    const message = await authorizedFetch(
      `${server.address()}/v1/koishi/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(messageRequest()),
      },
    );
    expect(message.status).toBe(200);
    await expect(message.json()).resolves.toMatchObject({
      reply: "HELLO",
      sessionId: "session-1",
    });

    const reset = await authorizedFetch(
      `${server.address()}/v1/koishi/sessions/reset`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          requestId: "reset-1",
          conversation: messageRequest().conversation,
        }),
      },
    );
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({
      reset: true,
      sessionId: "session-2",
    });
  });

  it("rejects invalid methods, media types, and large bodies", async () => {
    const server = await start(noopRuntime(), 512);
    const wrongMethod = await authorizedFetch(
      `${server.address()}/v1/koishi/messages`,
    );
    expect(wrongMethod.status).toBe(405);

    const wrongType = await authorizedFetch(
      `${server.address()}/v1/koishi/messages`,
      {
        method: "POST",
        body: "{}",
      },
    );
    expect(wrongType.status).toBe(415);

    const large = await authorizedFetch(
      `${server.address()}/v1/koishi/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: "x".repeat(1000) }),
      },
    );
    expect(large.status).toBe(413);
  });

  it("maps capacity failures to retryable status 429", async () => {
    const server = await start({
      ...noopRuntime(),
      dispatch: async () => {
        throw new GatewayBusyError();
      },
    });
    const response = await authorizedFetch(
      `${server.address()}/v1/koishi/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(messageRequest()),
      },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "gateway_busy" },
    });
  });
});

async function start(
  runtime: GatewayRuntime,
  maxBodyBytes = 4096,
): Promise<GatewayServer> {
  const server = new GatewayServer(
    {
      host: "127.0.0.1",
      port: 0,
      messagePath: "/v1/koishi/messages",
      resetPath: "/v1/koishi/sessions/reset",
      healthPath: "/healthz",
      token,
      maxInputChars: 1000,
      maxBodyBytes,
      requestTimeoutMs: 1000,
    },
    runtime,
    { info: () => {}, warn: () => {} },
  );
  await server.start();
  servers.push(server);
  return server;
}

function authorizedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

function noopRuntime(): GatewayRuntime {
  return {
    dispatch: async () => ({ sessionId: "session", reply: "" }),
    reset: async () => ({ sessionId: "session", reset: true }),
    stats: () => ({ sessions: 0, activeSessions: 0, pendingTurns: 0 }),
  };
}

function messageRequest(): MessageRequest {
  return {
    version: PROTOCOL_VERSION,
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
