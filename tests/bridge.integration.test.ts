import { afterEach, describe, expect, it } from "vitest";

import {
  DshBridgeBusyError,
  DshGatewayClient,
  resolveConfig as resolveClientConfig,
} from "koishi-plugin-dsh-bridge";
import {
  GatewayBusyError,
  GatewayServer,
  type GatewayRuntime,
} from "dsh-plugin-koishi";
import {
  PROTOCOL_VERSION,
  type MessageRequest,
  type ResetRequest,
} from "dsh-plugin-koishi/protocol";

const token = "integration-token-".padEnd(64, "x");
const servers: GatewayServer[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

describe("two-package bridge", () => {
  it("round-trips health, message, and reset envelopes", async () => {
    const server = await start({
      dispatch: async (request) => ({
        sessionId: "session-1",
        reply: `echo:${request.message.text}`,
      }),
      reset: async () => ({ sessionId: "session-2", reset: true }),
      stats: () => ({ sessions: 1, activeSessions: 0, pendingTurns: 0 }),
    });
    const client = clientFor(server);

    await expect(client.health()).resolves.toMatchObject({ sessions: 1 });
    await expect(client.send(messageRequest())).resolves.toBe("echo:hello");
    await expect(client.reset(resetRequest())).resolves.toBeUndefined();
  });

  it("preserves retryable busy semantics across HTTP", async () => {
    const server = await start({
      dispatch: async () => {
        throw new GatewayBusyError();
      },
      reset: async () => ({ sessionId: "session", reset: true }),
      stats: () => ({ sessions: 0, activeSessions: 0, pendingTurns: 0 }),
    });
    const client = clientFor(server);

    await expect(client.send(messageRequest())).rejects.toBeInstanceOf(
      DshBridgeBusyError,
    );
  });
});

async function start(runtime: GatewayRuntime): Promise<GatewayServer> {
  const server = new GatewayServer(
    {
      host: "127.0.0.1",
      port: 0,
      messagePath: "/v1/koishi/messages",
      resetPath: "/v1/koishi/sessions/reset",
      healthPath: "/healthz",
      token,
      maxInputChars: 1000,
      maxBodyBytes: 4096,
      requestTimeoutMs: 1000,
    },
    runtime,
    { info: () => {}, warn: () => {} },
  );
  await server.start();
  servers.push(server);
  return server;
}

function clientFor(server: GatewayServer): DshGatewayClient {
  return new DshGatewayClient(
    resolveClientConfig(
      {
        baseURL: server.address(),
        token,
        allowedChannels: [{ platform: "*", channelId: "*" }],
        eagerCheck: false,
        requestTimeoutMs: 1000,
      },
      {},
    ),
  );
}

function messageRequest(): MessageRequest {
  return {
    version: PROTOCOL_VERSION,
    requestId: "request-1",
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
    version: PROTOCOL_VERSION,
    requestId: "reset-1",
    conversation: messageRequest().conversation,
  };
}
