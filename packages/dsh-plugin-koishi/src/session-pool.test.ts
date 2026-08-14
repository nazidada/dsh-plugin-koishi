import type { AgentCancelCause, UserMessage } from "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { describe, expect, it } from "vitest";

import type { MessageRequest, ResetRequest } from "./protocol.js";
import {
  SessionPool,
  finalAssistantText,
  type AgentCreateInput,
  type AgentFactoryLike,
  type AgentHandleLike,
  type AgentLike,
  type AgentSessionLike,
  type SessionPoolConfig,
} from "./session-pool.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

class FakeSession implements AgentSessionLike {
  public readonly events: SessionEvent[] = [];

  public get seq(): number {
    return this.events.length;
  }

  public assistant(text: string): void {
    this.events.push(assistantEvent(this.events.length, text));
  }
}

class FakeAgent implements AgentLike {
  public readonly session = new FakeSession();
  public readonly cancellations: AgentCancelCause[] = [];
  private idle: Promise<void> = Promise.resolve();

  public constructor(
    private readonly run: (
      agent: FakeAgent,
      message: UserMessage,
    ) => Promise<void>,
  ) {}

  public followup(message: UserMessage): void {
    this.idle = this.run(this, message);
  }

  public whenIdle(): Promise<void> {
    return this.idle;
  }

  public cancel(cause: AgentCancelCause): void {
    this.cancellations.push(cause);
  }
}

class FakeFactory implements AgentFactoryLike {
  public readonly inputs: AgentCreateInput[] = [];
  public readonly agents: FakeAgent[] = [];
  public disposals = 0;

  public constructor(
    private readonly run: (
      agent: FakeAgent,
      message: UserMessage,
    ) => Promise<void>,
  ) {}

  public async create(input: AgentCreateInput): Promise<AgentHandleLike> {
    this.inputs.push(input);
    const agent = new FakeAgent(this.run);
    this.agents.push(agent);
    return {
      agent,
      dispose: async () => {
        this.disposals += 1;
      },
    };
  }
}

const baseConfig: SessionPoolConfig = {
  provider: "mock",
  model: "mock",
  maxTokens: 100,
  workspacePath: "/workspace",
  sessionScope: "channel",
  includeSenderInGroups: true,
  turnTimeoutMs: 1000,
  maxPendingPerSession: 4,
  maxSessions: 4,
  idleTtlMs: 60_000,
  dedupeTtlMs: 60_000,
  maxDedupeEntriesPerSession: 16,
};

describe("SessionPool", () => {
  it("serializes turns in one conversation", async () => {
    let active = 0;
    let maxActive = 0;
    const factory = new FakeFactory(async (agent, message) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      agent.session.assistant(textOf(message));
      active -= 1;
    });
    const pool = new SessionPool(factory, baseConfig, undefined, "test");

    const [first, second] = await Promise.all([
      pool.dispatch(messageRequest("request-1", "one")),
      pool.dispatch(messageRequest("request-2", "two")),
    ]);

    expect(maxActive).toBe(1);
    expect(first.reply).toContain("one");
    expect(second.reply).toContain("two");
    expect(factory.inputs).toHaveLength(1);
    await pool.close();
  });

  it("allows different conversations to run concurrently", async () => {
    const bothStarted = deferred<void>();
    let active = 0;
    let maxActive = 0;
    const factory = new FakeFactory(async (agent) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 2) bothStarted.resolve();
      await bothStarted.promise;
      agent.session.assistant("done");
      active -= 1;
    });
    const pool = new SessionPool(factory, baseConfig, undefined, "test");

    await Promise.all([
      pool.dispatch(messageRequest("request-1", "one", "channel-1")),
      pool.dispatch(messageRequest("request-2", "two", "channel-2")),
    ]);

    expect(maxActive).toBe(2);
    expect(factory.inputs).toHaveLength(2);
    await pool.close();
  });

  it("deduplicates the same request id", async () => {
    let calls = 0;
    const factory = new FakeFactory(async (agent) => {
      calls += 1;
      agent.session.assistant("once");
    });
    const pool = new SessionPool(factory, baseConfig, undefined, "test");
    const request = messageRequest("same-request", "hello");
    const first = pool.dispatch(request);
    const second = pool.dispatch(request);

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ reply: "once" });
    expect(calls).toBe(1);
    await pool.close();
  });

  it("keeps active requests deduplicated after the result TTL duration", async () => {
    const release = deferred<void>();
    let calls = 0;
    const factory = new FakeFactory(async (agent) => {
      calls += 1;
      await release.promise;
      agent.session.assistant("once");
    });
    const pool = new SessionPool(
      factory,
      { ...baseConfig, dedupeTtlMs: 5 },
      undefined,
      "test",
    );
    const request = messageRequest("same-request", "hello");
    const first = pool.dispatch(request);
    await delay(10);
    const replay = pool.dispatch(request);

    expect(replay).toBe(first);
    release.resolve();
    await expect(first).resolves.toMatchObject({ reply: "once" });
    expect(calls).toBe(1);
    await pool.close();
  });

  it("rejects excess queued work before invoking the model", async () => {
    const release = deferred<void>();
    const factory = new FakeFactory(async (agent) => {
      await release.promise;
      agent.session.assistant("done");
    });
    const pool = new SessionPool(
      factory,
      { ...baseConfig, maxPendingPerSession: 2 },
      undefined,
      "test",
    );
    const first = pool.dispatch(messageRequest("request-1", "one"));
    const second = pool.dispatch(messageRequest("request-2", "two"));

    expect(() => pool.dispatch(messageRequest("request-3", "three"))).toThrow(
      /queue is full/,
    );
    release.resolve();
    await Promise.all([first, second]);
    await pool.close();
  });

  it("cancels, retires, and advances the generation after a timeout", async () => {
    const never = new Promise<void>(() => {});
    const factory = new FakeFactory(async () => await never);
    const pool = new SessionPool(
      factory,
      { ...baseConfig, turnTimeoutMs: 20 },
      undefined,
      "test",
    );

    await expect(
      pool.dispatch(messageRequest("request-1", "hang")),
    ).rejects.toMatchObject({
      name: "TurnTimeoutError",
    });
    await delay(0);
    expect(factory.agents[0]?.cancellations.map((cause) => cause.kind)).toEqual(
      ["hook", "disposed"],
    );
    expect(factory.disposals).toBe(1);
    await pool.close();
  });

  it("uses a fresh session id after reset", async () => {
    const factory = new FakeFactory(async (agent) =>
      agent.session.assistant("done"),
    );
    const pool = new SessionPool(factory, baseConfig, undefined, "test");
    const first = await pool.dispatch(messageRequest("request-1", "one"));
    const reset = await pool.reset(resetRequest("reset-1"));
    const second = await pool.dispatch(messageRequest("request-2", "two"));

    expect(reset.sessionId).not.toBe(first.sessionId);
    expect(second.sessionId).toBe(reset.sessionId);
    expect(factory.inputs.map((input) => input.sessionId)).toHaveLength(2);
    await pool.close();
  });

  it("never reuses a session id after capacity eviction", async () => {
    const factory = new FakeFactory(async (agent) =>
      agent.session.assistant("done"),
    );
    const pool = new SessionPool(
      factory,
      { ...baseConfig, maxSessions: 1 },
      undefined,
      "test",
    );
    const first = await pool.dispatch(
      messageRequest("request-1", "one", "channel-1"),
    );
    await pool.dispatch(messageRequest("request-2", "two", "channel-2"));
    const recreated = await pool.dispatch(
      messageRequest("request-3", "three", "channel-1"),
    );

    expect(recreated.sessionId).not.toBe(first.sessionId);
    expect(factory.inputs.map((input) => input.sessionId)).toHaveLength(3);
    await pool.close();
  });

  it("bounds deduplication records without evicting active work", async () => {
    let calls = 0;
    const release = deferred<void>();
    const factory = new FakeFactory(async (agent) => {
      calls += 1;
      if (calls === 1) await release.promise;
      agent.session.assistant("done");
    });
    const pool = new SessionPool(
      factory,
      {
        ...baseConfig,
        maxPendingPerSession: 2,
        maxDedupeEntriesPerSession: 1,
      },
      undefined,
      "test",
    );
    const first = pool.dispatch(messageRequest("request-1", "one"));

    expect(() => pool.dispatch(messageRequest("request-2", "two"))).toThrow(
      /deduplication cache is full/,
    );
    release.resolve();
    await first;
    await pool.dispatch(messageRequest("request-2", "two"));
    await pool.dispatch(messageRequest("request-1", "one"));

    expect(calls).toBe(3);
    await pool.close();
  });

  it("extracts only the last assistant message text blocks", () => {
    const events = [assistantEvent(0, "first"), assistantEvent(1, "last")];
    expect(finalAssistantText(events)).toBe("last");
    expect(finalAssistantText([])).toBe("");
  });
});

function messageRequest(
  requestId: string,
  text: string,
  channelId = "channel-1",
): MessageRequest {
  return {
    version: 1,
    requestId,
    conversation: {
      platform: "test",
      selfId: "bot",
      channelId,
      userId: "user",
      isDirect: false,
    },
    message: { text, authorName: "Alice" },
  };
}

function resetRequest(requestId: string): ResetRequest {
  const { conversation } = messageRequest("unused", "unused");
  return { version: 1, requestId, conversation };
}

function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: "assistant/message",
    seq,
    time: 0,
    data: {
      turn: 0,
      step: 0,
      message: {
        id: `assistant-${seq}`,
        role: "assistant",
        content: [{ type: "text", text }],
        source: { kind: "model", provider: "mock", model: "mock" },
      },
    },
  } as unknown as SessionEvent;
}

function textOf(message: UserMessage): string {
  return message.content
    .filter(
      (block): block is typeof block & { type: "text"; text: string } =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
