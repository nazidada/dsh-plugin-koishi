import { randomBytes } from "node:crypto";

import type { AgentCancelCause, UserMessage } from "@deepseek-ai/dsh-session";
import { SessionId, type SessionEvent } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

import {
  GatewayBusyError,
  GatewayClosedError,
  TurnTimeoutError,
} from "./errors.js";
import type { MessageRequest, ResetRequest } from "./protocol.js";
import {
  conversationKey,
  deriveSessionId,
  formatPrompt,
  type SessionScope,
} from "./routing.js";

export interface AgentSessionLike {
  readonly seq: number;
  readonly events: readonly SessionEvent[];
}

export interface AgentLike {
  readonly session: AgentSessionLike;
  followup(message: UserMessage): void;
  whenIdle(): Promise<void>;
  cancel(cause: AgentCancelCause): void;
}

export interface AgentHandleLike {
  readonly agent: AgentLike;
  dispose(): Promise<void>;
}

export interface AgentCreateInput {
  readonly sessionId: SessionId;
  readonly meta: { readonly cwd: string };
  readonly agentOptions: {
    readonly provider: string;
    readonly model: string;
    readonly maxTokens: number;
  };
}

export interface AgentFactoryLike {
  create(input: AgentCreateInput): Promise<AgentHandleLike>;
}

export interface SessionPoolConfig {
  readonly provider: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly workspacePath: string;
  readonly sessionScope: SessionScope;
  readonly includeSenderInGroups: boolean;
  readonly turnTimeoutMs: number;
  readonly maxPendingPerSession: number;
  readonly maxSessions: number;
  readonly idleTtlMs: number;
  readonly dedupeTtlMs: number;
  readonly maxDedupeEntriesPerSession: number;
}

export interface DispatchResult {
  readonly sessionId: string;
  readonly reply: string;
}

export interface ResetResult {
  readonly sessionId: string;
  readonly reset: true;
}

export interface PoolStats {
  readonly sessions: number;
  readonly activeSessions: number;
  readonly pendingTurns: number;
}

interface DedupeRecord<T> {
  readonly promise: Promise<T>;
  expiresAt: number;
  settled: boolean;
}

interface SessionEntry {
  readonly key: string;
  readonly messageDedupe: Map<string, DedupeRecord<DispatchResult>>;
  readonly resetDedupe: Map<string, DedupeRecord<ResetResult>>;
  generation: number;
  handle: AgentHandleLike | undefined;
  pending: number;
  tail: Promise<void>;
  lastUsed: number;
}

/** Owns opaque Harness agents, one serial queue per normalized Koishi conversation. */
export class SessionPool {
  private readonly entries = new Map<string, SessionEntry>();
  private readonly retirements = new Set<Promise<void>>();
  private readonly runtimeId: string;
  private nextGeneration = 0;
  private closed = false;

  public constructor(
    private readonly factory: AgentFactoryLike,
    private readonly config: SessionPoolConfig,
    private readonly reportError: (error: unknown) => void = () => {},
    runtimeId = randomBytes(6).toString("hex"),
  ) {
    this.runtimeId = runtimeId;
  }

  /** Queue one message and return the final assistant text from its owned activity interval. */
  public dispatch(request: MessageRequest): Promise<DispatchResult> {
    this.assertOpen();
    const entry = this.entryFor(request);
    this.pruneDedupe(entry);
    const cached = entry.messageDedupe.get(request.requestId);
    if (cached !== undefined) return cached.promise;
    if (entry.pending >= this.config.maxPendingPerSession) {
      throw new GatewayBusyError("the conversation queue is full");
    }

    this.ensureDedupeCapacity(entry.messageDedupe);
    const promise = this.enqueue(entry, () => this.execute(entry, request));
    this.cache(entry.messageDedupe, request.requestId, promise);
    return promise;
  }

  /** Dispose one conversation agent and advance to a fresh opaque Session id. */
  public reset(request: ResetRequest): Promise<ResetResult> {
    this.assertOpen();
    const entry = this.entryFor(request);
    this.pruneDedupe(entry);
    const cached = entry.resetDedupe.get(request.requestId);
    if (cached !== undefined) return cached.promise;
    if (entry.pending >= this.config.maxPendingPerSession) {
      throw new GatewayBusyError("the conversation queue is full");
    }

    this.ensureDedupeCapacity(entry.resetDedupe);
    const promise = this.enqueue(entry, async () => {
      const handle = entry.handle;
      entry.handle = undefined;
      entry.generation = this.allocateGeneration();
      if (handle !== undefined) {
        handle.agent.cancel({ kind: "disposed" });
        await handle.dispose();
      }
      entry.lastUsed = Date.now();
      return {
        sessionId: this.sessionId(entry),
        reset: true as const,
      };
    });
    this.cache(entry.resetDedupe, request.requestId, promise);
    return promise;
  }

  /** Snapshot bounded health counters without exposing conversation identifiers. */
  public stats(): PoolStats {
    let activeSessions = 0;
    let pendingTurns = 0;
    for (const entry of this.entries.values()) {
      if (entry.pending > 0) activeSessions += 1;
      pendingTurns += entry.pending;
    }
    return Object.freeze({
      sessions: this.entries.size,
      activeSessions,
      pendingTurns,
    });
  }

  /** Stop admission, cancel active work, drain queues, and dispose every owned handle. */
  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.handle?.agent.cancel({ kind: "disposed" });
    }
    await Promise.allSettled(
      [...this.entries.values()].map((entry) => entry.tail),
    );
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.map((entry) => this.disposeEntry(entry)));
    await Promise.allSettled(this.retirements);
  }

  private entryFor(request: MessageRequest | ResetRequest): SessionEntry {
    const now = Date.now();
    this.sweepExpired(now);
    const key = conversationKey(request.conversation, this.config.sessionScope);
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    if (this.entries.size >= this.config.maxSessions) this.evictOneIdle();
    if (this.entries.size >= this.config.maxSessions) {
      throw new GatewayBusyError("the gateway session capacity is full");
    }
    const entry: SessionEntry = {
      key,
      messageDedupe: new Map(),
      resetDedupe: new Map(),
      generation: this.allocateGeneration(),
      handle: undefined,
      pending: 0,
      tail: Promise.resolve(),
      lastUsed: now,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private enqueue<T>(entry: SessionEntry, task: () => Promise<T>): Promise<T> {
    entry.pending += 1;
    const promise = entry.tail.then(async () => {
      this.assertOpen();
      return await task();
    });
    entry.tail = promise.then(
      () => undefined,
      () => undefined,
    );
    void promise.then(
      () => this.finishTask(entry),
      () => this.finishTask(entry),
    );
    return promise;
  }

  private finishTask(entry: SessionEntry): void {
    entry.pending -= 1;
    entry.lastUsed = Date.now();
  }

  private async execute(
    entry: SessionEntry,
    request: MessageRequest,
  ): Promise<DispatchResult> {
    const handle = await this.handleFor(entry);
    const agent = handle.agent;
    const fromSeq = agent.session.seq;
    const message = createUserMessage({
      content: [
        {
          type: "text",
          text: formatPrompt(request, this.config.includeSenderInGroups),
        },
      ],
      source: { kind: "user" },
    });

    try {
      agent.followup(message);
      await this.waitForIdle(agent);
    } catch (error) {
      this.invalidate(entry, handle);
      throw error;
    }

    return Object.freeze({
      sessionId: this.sessionId(entry),
      reply: finalAssistantText(agent.session.events.slice(fromSeq)),
    });
  }

  private async handleFor(entry: SessionEntry): Promise<AgentHandleLike> {
    if (entry.handle !== undefined) return entry.handle;
    const handle = await this.factory.create({
      sessionId: SessionId(this.sessionId(entry)),
      meta: { cwd: this.config.workspacePath },
      agentOptions: {
        provider: this.config.provider,
        model: this.config.model,
        maxTokens: this.config.maxTokens,
      },
    });
    entry.handle = handle;
    return handle;
  }

  private async waitForIdle(agent: AgentLike): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        agent.cancel({ kind: "hook", reason: "koishi gateway turn timeout" });
        reject(new TurnTimeoutError(this.config.turnTimeoutMs));
      }, this.config.turnTimeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([agent.whenIdle(), timeout]);
    } catch (error) {
      if (timedOut && !(error instanceof TurnTimeoutError)) {
        throw new TurnTimeoutError(this.config.turnTimeoutMs);
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private invalidate(entry: SessionEntry, handle: AgentHandleLike): void {
    if (entry.handle !== handle) return;
    entry.handle = undefined;
    entry.generation = this.allocateGeneration();
    handle.agent.cancel({ kind: "disposed" });
    this.trackRetirement(handle.dispose());
  }

  private sessionId(entry: SessionEntry): string {
    return deriveSessionId(this.runtimeId, entry.key, entry.generation);
  }

  private pruneDedupe(entry: SessionEntry): void {
    const now = Date.now();
    for (const [requestId, record] of entry.messageDedupe) {
      if (record.settled && record.expiresAt <= now)
        entry.messageDedupe.delete(requestId);
    }
    for (const [requestId, record] of entry.resetDedupe) {
      if (record.settled && record.expiresAt <= now)
        entry.resetDedupe.delete(requestId);
    }
  }

  private ensureDedupeCapacity<T>(records: Map<string, DedupeRecord<T>>): void {
    while (records.size >= this.config.maxDedupeEntriesPerSession) {
      const settled = [...records].find(([, record]) => record.settled);
      if (settled === undefined) {
        throw new GatewayBusyError(
          "the conversation deduplication cache is full",
        );
      }
      records.delete(settled[0]);
    }
  }

  private cache<T>(
    records: Map<string, DedupeRecord<T>>,
    requestId: string,
    promise: Promise<T>,
  ): void {
    const record: DedupeRecord<T> = {
      promise,
      expiresAt: Number.POSITIVE_INFINITY,
      settled: false,
    };
    records.set(requestId, record);
    void promise.then(
      () => {
        record.settled = true;
        record.expiresAt = Date.now() + this.config.dedupeTtlMs;
      },
      () => {
        record.settled = true;
        record.expiresAt = Date.now() + this.config.dedupeTtlMs;
      },
    );
  }

  private allocateGeneration(): number {
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    return generation;
  }

  private sweepExpired(now: number): void {
    const cutoff = now - this.config.idleTtlMs;
    for (const [key, entry] of this.entries) {
      if (entry.pending !== 0 || entry.lastUsed > cutoff) continue;
      this.entries.delete(key);
      this.trackRetirement(this.disposeEntry(entry));
    }
  }

  private evictOneIdle(): void {
    let victim: SessionEntry | undefined;
    for (const entry of this.entries.values()) {
      if (entry.pending !== 0) continue;
      if (victim === undefined || entry.lastUsed < victim.lastUsed)
        victim = entry;
    }
    if (victim === undefined) return;
    this.entries.delete(victim.key);
    this.trackRetirement(this.disposeEntry(victim));
  }

  private async disposeEntry(entry: SessionEntry): Promise<void> {
    const handle = entry.handle;
    entry.handle = undefined;
    if (handle === undefined) return;
    handle.agent.cancel({ kind: "disposed" });
    await handle.dispose();
  }

  private trackRetirement(task: Promise<void>): void {
    const tracked = task
      .catch((error) => {
        this.reportError(error);
      })
      .finally(() => {
        this.retirements.delete(tracked);
      });
    this.retirements.add(tracked);
  }

  private assertOpen(): void {
    if (this.closed) throw new GatewayClosedError();
  }
}

/** Extract text blocks from the final assistant message in one owned event interval. */
export function finalAssistantText(events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "assistant/message") continue;
    return event.data.message.content
      .filter(
        (block): block is typeof block & { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();
  }
  return "";
}
