import type { Context, Next, Session } from "koishi";

import {
  Config as ConfigSchema,
  resolveConfig,
  type Config,
  type ResolvedConfig,
} from "./config.js";
import {
  DshBridgeBusyError,
  DshBridgeTimeoutError,
  DshGatewayClient,
  type FetchLike,
} from "./client.js";
import { Service } from "./koishi.js";
import {
  prepareIncomingMessage,
  prepareResetRequest,
  routeFingerprint,
} from "./routing.js";

declare module "koishi" {
  interface Context {
    dshBridge: DshBridgeService;
  }
}

/** Koishi service that detaches live Session input before crossing HTTP. */
export class DshBridgeService extends Service<ResolvedConfig> {
  public static override readonly name = "dshBridge";
  public static readonly Config = ConfigSchema;
  public static readonly usage =
    "将允许的 Koishi 文本会话转发到 dsh-plugin-koishi。";

  private readonly client: DshGatewayClient;

  public constructor(ctx: Context, input: Config = {}, fetchImpl?: FetchLike) {
    super(ctx, "dshBridge");
    this.config = resolveConfig(input);
    this.client = new DshGatewayClient(this.config, fetchImpl);

    ctx.middleware((session, next) => this.handle(session, next));
    ctx
      .command("dsh.reset", "重置当前 DeepSeek Harness 会话")
      .action(async ({ session }) => {
        if (!session) return "当前没有可重置的会话。";
        const request = prepareResetRequest(
          session,
          this.config.allowedChannels,
        );
        if (request === undefined) return this.config.resetDeniedReply;
        try {
          await this.client.reset(request);
          return this.config.resetReply;
        } catch (error) {
          this.warnFailure(session, error);
          return this.replyForError(error);
        }
      });
  }

  /** Forward an already detached and validated request for trusted Koishi plugins. */
  public send(
    request: Parameters<DshGatewayClient["send"]>[0],
  ): Promise<string> {
    return this.client.send(request);
  }

  /** Verify the configured gateway and return its aggregate counters. */
  public health(): ReturnType<DshGatewayClient["health"]> {
    return this.client.health();
  }

  protected override async start(): Promise<void> {
    if (this.config.allowedChannels.length === 0) {
      this.logger.warn("allowedChannels 为空；所有外部会话都会被拒绝");
    }
    if (this.config.eagerCheck) await this.client.health();
  }

  private async handle(session: Session, next: Next): Promise<void | string> {
    const prepared = prepareIncomingMessage(session, this.config);
    if (prepared.kind === "skip") return next() as Promise<void>;
    if (prepared.kind === "reject") return prepared.reply;

    try {
      const reply = (await this.client.send(prepared.request)).trim();
      return reply || this.config.emptyReply;
    } catch (error) {
      this.warnFailure(session, error);
      return this.replyForError(error);
    }
  }

  private replyForError(error: unknown): string {
    if (error instanceof DshBridgeBusyError) return this.config.busyReply;
    if (error instanceof DshBridgeTimeoutError) return this.config.timeoutReply;
    return this.config.errorReply;
  }

  private warnFailure(session: Session, error: unknown): void {
    const conversation = {
      platform: session.platform,
      selfId: session.selfId,
      channelId: session.channelId ?? "unknown",
      userId: session.userId ?? "unknown",
      isDirect: session.isDirect,
    };
    this.logger.warn(
      "bridge request failed on platform=%s route=%s error=%s",
      session.platform,
      routeFingerprint(conversation),
      errorName(error),
    );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export default DshBridgeService;
