import {
  isErrorResponse,
  isHealthResponse,
  isMessageSuccessResponse,
  isResetSuccessResponse,
  type HealthResponse,
  type MessageRequest,
  type ResetRequest,
} from "dsh-plugin-koishi/protocol";

import type { ResolvedConfig } from "./config.js";

export type FetchLike = typeof fetch;

export class DshBridgeHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`DSH gateway request failed with status ${status} (${code})`);
    this.name = "DshBridgeHttpError";
  }
}

export class DshBridgeBusyError extends DshBridgeHttpError {
  public constructor(status = 429) {
    super(status, "gateway_busy");
    this.name = "DshBridgeBusyError";
  }
}

export class DshBridgeTimeoutError extends Error {
  public constructor() {
    super("DSH gateway request timed out");
    this.name = "DshBridgeTimeoutError";
  }
}

export class DshBridgeProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DshBridgeProtocolError";
  }
}

/** Small fetch client that validates every gateway response before exposing it. */
export class DshGatewayClient {
  public constructor(
    private readonly config: ResolvedConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  /** Forward one detached Koishi message and return final assistant text. */
  public async send(request: MessageRequest): Promise<string> {
    const value = await this.request(this.config.messagePath, "POST", request);
    if (
      !isMessageSuccessResponse(value) ||
      value.requestId !== request.requestId
    ) {
      throw new DshBridgeProtocolError(
        "gateway returned an invalid message response",
      );
    }
    return value.reply;
  }

  /** Reset one detached conversation. */
  public async reset(request: ResetRequest): Promise<void> {
    const value = await this.request(this.config.resetPath, "POST", request);
    if (
      !isResetSuccessResponse(value) ||
      value.requestId !== request.requestId
    ) {
      throw new DshBridgeProtocolError(
        "gateway returned an invalid reset response",
      );
    }
  }

  /** Verify listener reachability, authentication, and protocol compatibility. */
  public async health(): Promise<HealthResponse> {
    const value = await this.request(this.config.healthPath, "GET");
    if (!isHealthResponse(value))
      throw new DshBridgeProtocolError(
        "gateway returned an invalid health response",
      );
    return value;
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    body?: object,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.requestTimeoutMs);
    timer.unref();
    try {
      const response = await this.fetchImpl(
        new URL(path, this.config.baseURL),
        {
          method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.config.token}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal: controller.signal,
        },
      );
      const text = await readBoundedText(response, 64 * 1024);
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        throw new DshBridgeProtocolError("gateway returned non-JSON content");
      }
      if (!response.ok) {
        const code = isErrorResponse(value)
          ? value.error.code
          : "invalid_error_response";
        if (response.status === 429 || code === "gateway_busy")
          throw new DshBridgeBusyError(response.status);
        if (response.status === 504 || code === "turn_timeout")
          throw new DshBridgeTimeoutError();
        throw new DshBridgeHttpError(response.status, code);
      }
      return value;
    } catch (error) {
      if (timedOut) throw new DshBridgeTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new DshBridgeProtocolError("gateway response exceeds 64 KiB");
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new DshBridgeProtocolError("gateway response exceeds 64 KiB");
    }
    chunks.push(value);
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}
