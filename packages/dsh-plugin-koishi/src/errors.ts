/** Stable operational errors mapped to non-2xx gateway responses. */

export class ChannelDeniedError extends Error {
  public constructor() {
    super("the channel is not allowed by the Harness gateway");
    this.name = "ChannelDeniedError";
  }
}

export class GatewayBusyError extends Error {
  public constructor(message = "the Harness gateway queue is full") {
    super(message);
    this.name = "GatewayBusyError";
  }
}

export class GatewayClosedError extends Error {
  public constructor() {
    super("the Harness gateway is shutting down");
    this.name = "GatewayClosedError";
  }
}

export class TurnTimeoutError extends Error {
  public constructor(public readonly timeoutMs: number) {
    super(`the Harness turn exceeded ${timeoutMs} ms`);
    this.name = "TurnTimeoutError";
  }
}
