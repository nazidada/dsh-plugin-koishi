import { resolve } from "node:path";

import z from "@deepseek-ai/schemastery";

import type { ChannelRule, SessionScope } from "./routing.js";
import {
  DEFAULT_HEALTH_PATH,
  DEFAULT_MESSAGE_PATH,
  DEFAULT_RESET_PATH,
} from "./protocol.js";

export interface Config {
  host?: string;
  port?: number;
  messagePath?: string;
  resetPath?: string;
  healthPath?: string;
  token?: string;
  tokenEnv?: string;
  provider?: string;
  model?: string;
  maxTokens?: number;
  workspacePath?: string;
  sessionScope?: SessionScope;
  includeSenderInGroups?: boolean;
  allowedChannels?: ChannelRule[];
  maxInputChars?: number;
  maxBodyBytes?: number;
  turnTimeoutMs?: number;
  maxPendingPerSession?: number;
  maxSessions?: number;
  idleTtlMs?: number;
  dedupeTtlMs?: number;
  maxDedupeEntriesPerSession?: number;
}

export interface ResolvedConfig {
  readonly host: string;
  readonly port: number;
  readonly messagePath: string;
  readonly resetPath: string;
  readonly healthPath: string;
  readonly token: string;
  readonly tokenEnv: string;
  readonly provider: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly workspacePath: string;
  readonly sessionScope: SessionScope;
  readonly includeSenderInGroups: boolean;
  readonly allowedChannels: readonly ChannelRule[];
  readonly maxInputChars: number;
  readonly maxBodyBytes: number;
  readonly turnTimeoutMs: number;
  readonly maxPendingPerSession: number;
  readonly maxSessions: number;
  readonly idleTtlMs: number;
  readonly dedupeTtlMs: number;
  readonly maxDedupeEntriesPerSession: number;
}

const sessionScopeSchema = z.union([
  z.const("channel"),
  z.const("user"),
  z.const("channel-user"),
]) as z<SessionScope>;

export const Config: z<Config> = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().step(1).min(0).max(65_535).default(8787),
  messagePath: z.string().default(DEFAULT_MESSAGE_PATH),
  resetPath: z.string().default(DEFAULT_RESET_PATH),
  healthPath: z.string().default(DEFAULT_HEALTH_PATH),
  token: z.string().role("secret"),
  tokenEnv: z.string().default("DSH_KOISHI_TOKEN"),
  provider: z.string().default("deepseek-official"),
  model: z.string().default("deepseek-v4-flash"),
  maxTokens: z.number().step(1).min(1).default(8192),
  workspacePath: z.string().default("."),
  sessionScope: sessionScopeSchema.default("channel"),
  includeSenderInGroups: z.boolean().default(true),
  allowedChannels: z
    .array(
      z.object({
        platform: z.string().required(),
        channelId: z.string().required(),
        isDirect: z.boolean(),
      }),
    )
    .default([]),
  maxInputChars: z.number().step(1).min(1).default(12_000),
  maxBodyBytes: z
    .number()
    .step(1)
    .min(1024)
    .default(128 * 1024),
  turnTimeoutMs: z.number().step(1).min(1000).default(180_000),
  maxPendingPerSession: z.number().step(1).min(1).default(8),
  maxSessions: z.number().step(1).min(1).default(128),
  idleTtlMs: z
    .number()
    .step(1)
    .min(1000)
    .default(30 * 60_000),
  dedupeTtlMs: z
    .number()
    .step(1)
    .min(1000)
    .default(5 * 60_000),
  maxDedupeEntriesPerSession: z.number().step(1).min(1).default(256),
}) as z<Config>;

/** Apply defaults and reject unsafe direct construction outside the Loader. */
export function resolveConfig(
  input: Config = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): ResolvedConfig {
  const tokenEnv = nonEmpty(input.tokenEnv, "DSH_KOISHI_TOKEN");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnv)) {
    throw new Error("tokenEnv must be a valid environment variable name");
  }
  const token = input.token?.trim() || env[tokenEnv]?.trim() || "";
  if (token.length < 32) {
    throw new Error(
      `gateway token must contain at least 32 characters (set token or ${tokenEnv})`,
    );
  }

  const paths = [
    normalizeHttpPath(input.messagePath, DEFAULT_MESSAGE_PATH, "messagePath"),
    normalizeHttpPath(input.resetPath, DEFAULT_RESET_PATH, "resetPath"),
    normalizeHttpPath(input.healthPath, DEFAULT_HEALTH_PATH, "healthPath"),
  ] as const;
  if (new Set(paths).size !== paths.length)
    throw new Error("messagePath, resetPath, and healthPath must be distinct");

  const maxPendingPerSession = positiveInteger(
    input.maxPendingPerSession,
    8,
    "maxPendingPerSession",
  );
  const maxDedupeEntriesPerSession = positiveInteger(
    input.maxDedupeEntriesPerSession,
    256,
    "maxDedupeEntriesPerSession",
  );
  if (maxDedupeEntriesPerSession < maxPendingPerSession) {
    throw new Error(
      "maxDedupeEntriesPerSession must be greater than or equal to maxPendingPerSession",
    );
  }

  return Object.freeze({
    host: nonEmpty(input.host, "127.0.0.1"),
    port: integerInRange(input.port, 8787, 0, 65_535, "port"),
    messagePath: paths[0],
    resetPath: paths[1],
    healthPath: paths[2],
    token,
    tokenEnv,
    provider: nonEmpty(input.provider, "deepseek-official"),
    model: nonEmpty(input.model, "deepseek-v4-flash"),
    maxTokens: positiveInteger(input.maxTokens, 8192, "maxTokens"),
    workspacePath: resolve(cwd, nonEmpty(input.workspacePath, ".")),
    sessionScope: input.sessionScope ?? "channel",
    includeSenderInGroups: input.includeSenderInGroups ?? true,
    allowedChannels: Object.freeze(
      (input.allowedChannels ?? []).map(validateRule),
    ),
    maxInputChars: positiveInteger(
      input.maxInputChars,
      12_000,
      "maxInputChars",
    ),
    maxBodyBytes: integerInRange(
      input.maxBodyBytes,
      128 * 1024,
      1024,
      Number.MAX_SAFE_INTEGER,
      "maxBodyBytes",
    ),
    turnTimeoutMs: integerInRange(
      input.turnTimeoutMs,
      180_000,
      1000,
      Number.MAX_SAFE_INTEGER,
      "turnTimeoutMs",
    ),
    maxPendingPerSession,
    maxSessions: positiveInteger(input.maxSessions, 128, "maxSessions"),
    idleTtlMs: integerInRange(
      input.idleTtlMs,
      30 * 60_000,
      1000,
      Number.MAX_SAFE_INTEGER,
      "idleTtlMs",
    ),
    dedupeTtlMs: integerInRange(
      input.dedupeTtlMs,
      5 * 60_000,
      1000,
      Number.MAX_SAFE_INTEGER,
      "dedupeTtlMs",
    ),
    maxDedupeEntriesPerSession,
  });
}

function validateRule(rule: ChannelRule, index: number): ChannelRule {
  const platform = rule.platform.trim();
  const channelId = rule.channelId.trim();
  if (!platform || !channelId)
    throw new Error(
      `allowedChannels[${index}] requires platform and channelId`,
    );
  return Object.freeze({
    platform,
    channelId,
    ...(rule.isDirect === undefined ? {} : { isDirect: rule.isDirect }),
  });
}

function normalizeHttpPath(
  value: string | undefined,
  fallback: string,
  field: string,
): string {
  const path = value?.trim() || fallback;
  if (
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("//")
  ) {
    throw new Error(
      `${field} must be an absolute URL path without query, fragment, or empty segment`,
    );
  }
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  return integerInRange(value, fallback, 1, Number.MAX_SAFE_INTEGER, field);
}

function integerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new Error(
      `${field} must be a safe integer between ${minimum} and ${maximum}`,
    );
  }
  return resolved;
}
