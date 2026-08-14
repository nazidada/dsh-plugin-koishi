/** Stable wire protocol shared by the Harness gateway and Koishi companion. */

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_MESSAGE_PATH = "/v1/koishi/messages";
export const DEFAULT_RESET_PATH = "/v1/koishi/sessions/reset";
export const DEFAULT_HEALTH_PATH = "/healthz";

export interface ConversationRef {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly isDirect: boolean;
}

export interface BridgeMessage {
  readonly text: string;
  readonly authorName?: string;
}

export interface MessageRequest {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly conversation: ConversationRef;
  readonly message: BridgeMessage;
  readonly sentAt?: number;
}

export interface ResetRequest {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly conversation: ConversationRef;
}

export interface MessageSuccessResponse {
  readonly ok: true;
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sessionId: string;
  readonly reply: string;
}

export interface ResetSuccessResponse {
  readonly ok: true;
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sessionId: string;
  readonly reset: true;
}

export interface HealthResponse {
  readonly ok: true;
  readonly version: typeof PROTOCOL_VERSION;
  readonly service: "dsh-plugin-koishi";
  readonly sessions: number;
  readonly activeSessions: number;
  readonly pendingTurns: number;
}

export type BridgeErrorCode =
  | "bad_request"
  | "body_too_large"
  | "channel_denied"
  | "gateway_busy"
  | "gateway_closed"
  | "internal_error"
  | "method_not_allowed"
  | "not_found"
  | "turn_timeout"
  | "unauthorized"
  | "unsupported_media_type";

const BRIDGE_ERROR_CODES: ReadonlySet<string> = new Set<BridgeErrorCode>([
  "bad_request",
  "body_too_large",
  "channel_denied",
  "gateway_busy",
  "gateway_closed",
  "internal_error",
  "method_not_allowed",
  "not_found",
  "turn_timeout",
  "unauthorized",
  "unsupported_media_type",
]);

export interface ErrorResponse {
  readonly ok: false;
  readonly version: typeof PROTOCOL_VERSION;
  readonly error: {
    readonly code: BridgeErrorCode;
    readonly message: string;
  };
}

export class ProtocolValidationError extends Error {
  public readonly code = "bad_request";

  public constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

/** Parse and detach one message request received at the HTTP boundary. */
export function parseMessageRequest(
  value: unknown,
  maxInputChars: number,
): MessageRequest {
  const record = readRecord(value, "request");
  assertKeys(
    record,
    ["version", "requestId", "conversation", "message", "sentAt"],
    "request",
  );
  readVersion(record.version);
  const requestId = readIdentifier(record.requestId, "requestId", 160);
  const conversation = readConversation(record.conversation);
  const messageRecord = readRecord(record.message, "message");
  assertKeys(messageRecord, ["text", "authorName"], "message");
  const text = readText(messageRecord.text, "message.text", maxInputChars);
  const authorName = readOptionalText(
    messageRecord.authorName,
    "message.authorName",
    128,
  );
  const sentAt = readOptionalTimestamp(record.sentAt);

  return Object.freeze({
    version: PROTOCOL_VERSION,
    requestId,
    conversation,
    message: Object.freeze({
      text,
      ...(authorName === undefined ? {} : { authorName }),
    }),
    ...(sentAt === undefined ? {} : { sentAt }),
  });
}

/** Parse and detach one reset request received at the HTTP boundary. */
export function parseResetRequest(value: unknown): ResetRequest {
  const record = readRecord(value, "request");
  assertKeys(record, ["version", "requestId", "conversation"], "request");
  readVersion(record.version);
  return Object.freeze({
    version: PROTOCOL_VERSION,
    requestId: readIdentifier(record.requestId, "requestId", 160),
    conversation: readConversation(record.conversation),
  });
}

/** Narrow an untrusted gateway response to the documented error envelope. */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (
    !isRecord(value) ||
    value.ok !== false ||
    value.version !== PROTOCOL_VERSION
  )
    return false;
  const error = value.error;
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    BRIDGE_ERROR_CODES.has(error.code) &&
    typeof error.message === "string"
  );
}

/** Narrow an untrusted gateway response to a successful message envelope. */
export function isMessageSuccessResponse(
  value: unknown,
): value is MessageSuccessResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.version === PROTOCOL_VERSION &&
    typeof value.requestId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.reply === "string"
  );
}

/** Narrow an untrusted gateway response to a successful reset envelope. */
export function isResetSuccessResponse(
  value: unknown,
): value is ResetSuccessResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.version === PROTOCOL_VERSION &&
    typeof value.requestId === "string" &&
    typeof value.sessionId === "string" &&
    value.reset === true
  );
}

/** Narrow an untrusted gateway response to the health envelope. */
export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.version === PROTOCOL_VERSION &&
    value.service === "dsh-plugin-koishi" &&
    Number.isSafeInteger(value.sessions) &&
    Number.isSafeInteger(value.activeSessions) &&
    Number.isSafeInteger(value.pendingTurns)
  );
}

function readConversation(value: unknown): ConversationRef {
  const record = readRecord(value, "conversation");
  assertKeys(
    record,
    ["platform", "selfId", "channelId", "userId", "isDirect"],
    "conversation",
  );
  if (typeof record.isDirect !== "boolean") {
    throw new ProtocolValidationError(
      "conversation.isDirect must be a boolean",
    );
  }
  return Object.freeze({
    platform: readIdentifier(record.platform, "conversation.platform", 128),
    selfId: readIdentifier(record.selfId, "conversation.selfId", 256),
    channelId: readIdentifier(record.channelId, "conversation.channelId", 256),
    userId: readIdentifier(record.userId, "conversation.userId", 256),
    isDirect: record.isDirect,
  });
}

function readVersion(value: unknown): void {
  if (value !== PROTOCOL_VERSION) {
    throw new ProtocolValidationError(`version must be ${PROTOCOL_VERSION}`);
  }
}

function readIdentifier(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ProtocolValidationError(
      `${field} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  if (value.trim() !== value || /\p{Cc}/u.test(value)) {
    throw new ProtocolValidationError(
      `${field} contains surrounding whitespace or control characters`,
    );
  }
  return value;
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string")
    throw new ProtocolValidationError(`${field} must be a string`);
  const text = value.trim();
  if (text.length === 0)
    throw new ProtocolValidationError(`${field} must not be empty`);
  if (text.length > maxLength) {
    throw new ProtocolValidationError(
      `${field} exceeds ${maxLength} characters`,
    );
  }
  return text;
}

function readOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new ProtocolValidationError(`${field} must be a string when present`);
  const text = value.trim();
  if (text.length === 0) return undefined;
  if (text.length > maxLength) {
    throw new ProtocolValidationError(
      `${field} exceeds ${maxLength} characters`,
    );
  }
  return text;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProtocolValidationError(
      "sentAt must be a non-negative safe integer when present",
    );
  }
  return value as number;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value))
    throw new ProtocolValidationError(`${field} must be a JSON object`);
  return value;
}

function assertKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new ProtocolValidationError(`${field} contains an unknown field`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
