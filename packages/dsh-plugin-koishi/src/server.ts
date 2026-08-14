import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

import {
  ChannelDeniedError,
  GatewayBusyError,
  GatewayClosedError,
  TurnTimeoutError,
} from "./errors.js";
import {
  PROTOCOL_VERSION,
  ProtocolValidationError,
  parseMessageRequest,
  parseResetRequest,
  type ErrorResponse,
  type HealthResponse,
  type MessageRequest,
  type MessageSuccessResponse,
  type ResetRequest,
  type ResetSuccessResponse,
} from "./protocol.js";
import type { DispatchResult, PoolStats, ResetResult } from "./session-pool.js";

export interface GatewayRuntime {
  dispatch(request: MessageRequest): Promise<DispatchResult>;
  reset(request: ResetRequest): Promise<ResetResult>;
  stats(): PoolStats;
}

export interface GatewayServerOptions {
  readonly host: string;
  readonly port: number;
  readonly messagePath: string;
  readonly resetPath: string;
  readonly healthPath: string;
  readonly token: string;
  readonly maxInputChars: number;
  readonly maxBodyBytes: number;
  readonly requestTimeoutMs: number;
}

export interface GatewayLogger {
  info(message: string): void;
  warn(message: string): void;
}

class HttpInputError extends Error {
  public constructor(
    public readonly code: "body_too_large" | "unsupported_media_type",
    message: string,
  ) {
    super(message);
    this.name = "HttpInputError";
  }
}

/** Minimal authenticated HTTP server owned by the DSH plugin lifecycle. */
export class GatewayServer {
  private readonly expectedTokenHash: Buffer;
  private readonly sockets = new Set<Socket>();
  private server: Server | undefined;
  private listenedPort: number | undefined;
  private closed = false;

  public constructor(
    private readonly options: GatewayServerOptions,
    private readonly runtime: GatewayRuntime,
    private readonly logger: GatewayLogger,
  ) {
    this.expectedTokenHash = digestToken(options.token);
  }

  /** Bind the configured listener and resolve only after the socket is ready. */
  public async start(): Promise<void> {
    if (this.server !== undefined) return;
    if (this.closed) throw new GatewayClosedError();
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        this.logger.warn(`unhandled request failure: ${errorName(error)}`);
        if (response.headersSent) response.destroy();
        else
          this.writeError(
            response,
            500,
            "internal_error",
            "internal gateway error",
          );
      });
    });
    server.maxHeadersCount = 32;
    server.headersTimeout = 10_000;
    server.requestTimeout = this.options.requestTimeoutMs;
    server.keepAliveTimeout = 5_000;
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.port, this.options.host);
    });
    this.listenedPort = (server.address() as AddressInfo).port;
    server.on("error", (error) =>
      this.logger.warn(`gateway listener error: ${error.name}`),
    );
  }

  /** Return the bound HTTP origin after start. */
  public address(): string {
    if (this.listenedPort === undefined)
      throw new Error("gateway server has not started");
    const host = this.options.host.includes(":")
      ? `[${this.options.host}]`
      : this.options.host;
    return `http://${host}:${this.listenedPort}`;
  }

  /** Stop accepting requests and destroy all plugin-owned connections. */
  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const socket of this.sockets) socket.destroy();
    });
    this.sockets.clear();
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const pathname = safePathname(request.url);
    if (!this.knownPath(pathname)) {
      this.writeError(response, 404, "not_found", "route not found");
      return;
    }
    if (!this.authorized(request)) {
      response.setHeader("www-authenticate", "Bearer");
      this.writeError(
        response,
        401,
        "unauthorized",
        "valid bearer token required",
      );
      return;
    }

    try {
      if (pathname === this.options.healthPath) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          this.writeError(
            response,
            405,
            "method_not_allowed",
            "method not allowed",
          );
          return;
        }
        const stats = this.runtime.stats();
        const body: HealthResponse = {
          ok: true,
          version: PROTOCOL_VERSION,
          service: "dsh-plugin-koishi",
          sessions: stats.sessions,
          activeSessions: stats.activeSessions,
          pendingTurns: stats.pendingTurns,
        };
        this.writeJson(response, 200, body);
        return;
      }

      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        this.writeError(
          response,
          405,
          "method_not_allowed",
          "method not allowed",
        );
        return;
      }
      const body = await this.readJson(request);
      if (pathname === this.options.messagePath) {
        const parsed = parseMessageRequest(body, this.options.maxInputChars);
        const result = await this.runtime.dispatch(parsed);
        const output: MessageSuccessResponse = {
          ok: true,
          version: PROTOCOL_VERSION,
          requestId: parsed.requestId,
          sessionId: result.sessionId,
          reply: result.reply,
        };
        this.writeJson(response, 200, output);
        return;
      }
      const parsed = parseResetRequest(body);
      const result = await this.runtime.reset(parsed);
      const output: ResetSuccessResponse = {
        ok: true,
        version: PROTOCOL_VERSION,
        requestId: parsed.requestId,
        sessionId: result.sessionId,
        reset: true,
      };
      this.writeJson(response, 200, output);
    } catch (error) {
      this.handleError(response, error, pathname);
    }
  }

  private handleError(
    response: ServerResponse,
    error: unknown,
    pathname: string,
  ): void {
    if (error instanceof ProtocolValidationError) {
      this.writeError(response, 400, "bad_request", error.message);
      return;
    }
    if (error instanceof HttpInputError) {
      const status = error.code === "body_too_large" ? 413 : 415;
      this.writeError(response, status, error.code, error.message);
      return;
    }
    if (error instanceof ChannelDeniedError) {
      this.writeError(
        response,
        403,
        "channel_denied",
        "channel is not allowed",
      );
      return;
    }
    if (error instanceof GatewayBusyError) {
      response.setHeader("retry-after", "1");
      this.writeError(
        response,
        429,
        "gateway_busy",
        "gateway capacity is temporarily full",
      );
      return;
    }
    if (error instanceof TurnTimeoutError) {
      this.writeError(response, 504, "turn_timeout", "Harness turn timed out");
      return;
    }
    if (error instanceof GatewayClosedError) {
      this.writeError(
        response,
        503,
        "gateway_closed",
        "gateway is shutting down",
      );
      return;
    }
    this.logger.warn(`request failed on ${pathname}: ${errorName(error)}`);
    this.writeError(response, 500, "internal_error", "internal gateway error");
  }

  private knownPath(pathname: string): boolean {
    return (
      pathname === this.options.messagePath ||
      pathname === this.options.resetPath ||
      pathname === this.options.healthPath
    );
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer "))
      return false;
    const received = header.slice("Bearer ".length);
    return timingSafeEqual(this.expectedTokenHash, digestToken(received));
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const contentType = request.headers["content-type"]
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      request.resume();
      throw new HttpInputError(
        "unsupported_media_type",
        "content-type must be application/json",
      );
    }
    const declaredLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.options.maxBodyBytes
    ) {
      request.resume();
      throw new HttpInputError(
        "body_too_large",
        "request body exceeds the configured limit",
      );
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      size += chunk.length;
      if (size > this.options.maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    }
    if (tooLarge)
      throw new HttpInputError(
        "body_too_large",
        "request body exceeds the configured limit",
      );
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new ProtocolValidationError("request body must contain valid JSON");
    }
  }

  private writeError(
    response: ServerResponse,
    status: number,
    code: ErrorResponse["error"]["code"],
    message: string,
  ): void {
    this.writeJson(response, status, {
      ok: false,
      version: PROTOCOL_VERSION,
      error: { code, message },
    } satisfies ErrorResponse);
  }

  private writeJson(
    response: ServerResponse,
    status: number,
    value: object,
  ): void {
    if (response.destroyed) return;
    const body = JSON.stringify(value);
    response.writeHead(status, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  }
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function safePathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "";
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
