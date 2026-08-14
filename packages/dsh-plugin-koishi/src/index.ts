/** DeepSeek Harness plugin exposing an authenticated Koishi message gateway. */

import { Service, type Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";

import {
  Config as ConfigSchema,
  resolveConfig,
  type Config as KoishiGatewayInput,
  type ResolvedConfig,
} from "./config.js";
import { ChannelDeniedError } from "./errors.js";
import type { MessageRequest, ResetRequest } from "./protocol.js";
import { matchesAllowedChannel, routeFingerprint } from "./routing.js";
import { GatewayServer } from "./server.js";
import {
  SessionPool,
  type DispatchResult,
  type PoolStats,
  type ResetResult,
} from "./session-pool.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    koishiGateway: KoishiGateway;
  }
}

export const name = "koishi-gateway";
export const Config = ConfigSchema;

/** Harness-side service that owns the HTTP listener and Koishi Agent sessions. */
export class KoishiGateway extends Service {
  public static inject = ["agents"];
  public static Config = ConfigSchema;

  private readonly resolved: ResolvedConfig;
  private readonly pool: SessionPool;
  private readonly server: GatewayServer;

  public constructor(ctx: Context, input: KoishiGatewayInput = {}) {
    super(ctx, "koishiGateway");
    this.resolved = resolveConfig(input);
    this.pool = new SessionPool(
      {
        create: (options) => ctx.agents.create(options),
      },
      this.resolved,
      (error) =>
        ctx.logger.warn(
          `Koishi session retirement failed: ${errorName(error)}`,
        ),
    );
    this.server = new GatewayServer(
      {
        host: this.resolved.host,
        port: this.resolved.port,
        messagePath: this.resolved.messagePath,
        resetPath: this.resolved.resetPath,
        healthPath: this.resolved.healthPath,
        token: this.resolved.token,
        maxInputChars: this.resolved.maxInputChars,
        maxBodyBytes: this.resolved.maxBodyBytes,
        requestTimeoutMs: this.resolved.turnTimeoutMs + 15_000,
      },
      {
        dispatch: (request) => this.dispatch(request),
        reset: (request) => this.reset(request),
        stats: () => this.stats(),
      },
      {
        info: (message) => ctx.logger.info(message),
        warn: (message) => ctx.logger.warn(message),
      },
    );
  }

  /** Submit one validated protocol request through the same policy as HTTP callers. */
  public dispatch(request: MessageRequest): Promise<DispatchResult> {
    this.assertAllowed(request);
    return this.pool.dispatch(request);
  }

  /** Reset one validated protocol conversation through the same policy as HTTP callers. */
  public reset(request: ResetRequest): Promise<ResetResult> {
    this.assertAllowed(request);
    return this.pool.reset(request);
  }

  /** Read aggregate gateway health counters. */
  public stats(): PoolStats {
    return this.pool.stats();
  }

  /** Return the bound origin after the service has started. */
  public address(): string {
    return this.server.address();
  }

  public async [Service.init](): Promise<void> {
    await this.server.start();
    this.ctx.effect(
      () => async () => {
        await this.server.close();
        await this.pool.close();
      },
      "koishiGateway.listen",
    );
    if (this.resolved.allowedChannels.length === 0) {
      this.ctx.logger.warn(
        "Koishi gateway is running with an empty allowedChannels list; all conversations are denied",
      );
    }
    this.ctx.logger.info(
      `Koishi gateway listening on ${this.server.address()}${this.resolved.messagePath}`,
    );
  }

  private assertAllowed(request: MessageRequest | ResetRequest): void {
    if (
      matchesAllowedChannel(request.conversation, this.resolved.allowedChannels)
    )
      return;
    this.ctx.logger.warn(
      `Koishi gateway denied platform=${request.conversation.platform} route=${routeFingerprint(request.conversation)}`,
    );
    throw new ChannelDeniedError();
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export default KoishiGateway;

export { resolveConfig } from "./config.js";
export type {
  Config as KoishiGatewayConfig,
  ResolvedConfig,
} from "./config.js";
export * from "./errors.js";
export * from "./protocol.js";
export * from "./routing.js";
export * from "./server.js";
export * from "./session-pool.js";
