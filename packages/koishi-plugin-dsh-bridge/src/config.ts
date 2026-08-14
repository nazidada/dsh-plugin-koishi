import type { Schema as SchemaType } from "koishi";

import {
  DEFAULT_HEALTH_PATH,
  DEFAULT_MESSAGE_PATH,
  DEFAULT_RESET_PATH,
} from "dsh-plugin-koishi/protocol";

import { Schema } from "./koishi.js";

export type TriggerMode = "direct-and-mention" | "mention" | "all";

export interface ChannelRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

export interface Config {
  baseURL?: string;
  messagePath?: string;
  resetPath?: string;
  healthPath?: string;
  token?: string;
  tokenEnv?: string;
  allowInsecureRemote?: boolean;
  trigger?: TriggerMode;
  allowedChannels?: ChannelRule[];
  maxInputChars?: number;
  requestTimeoutMs?: number;
  eagerCheck?: boolean;
  emptyReply?: string;
  busyReply?: string;
  timeoutReply?: string;
  inputTooLongReply?: string;
  errorReply?: string;
  resetReply?: string;
  resetDeniedReply?: string;
}

export interface ResolvedConfig {
  readonly baseURL: string;
  readonly messagePath: string;
  readonly resetPath: string;
  readonly healthPath: string;
  readonly token: string;
  readonly tokenEnv: string;
  readonly allowInsecureRemote: boolean;
  readonly trigger: TriggerMode;
  readonly allowedChannels: readonly ChannelRule[];
  readonly maxInputChars: number;
  readonly requestTimeoutMs: number;
  readonly eagerCheck: boolean;
  readonly emptyReply: string;
  readonly busyReply: string;
  readonly timeoutReply: string;
  readonly inputTooLongReply: string;
  readonly errorReply: string;
  readonly resetReply: string;
  readonly resetDeniedReply: string;
}

const triggerSchema = Schema.union([
  Schema.const("direct-and-mention").description(
    "私聊响应；群聊仅在机器人被点名时响应",
  ),
  Schema.const("mention").description("私聊和群聊都仅在机器人被点名时响应"),
  Schema.const("all").description("响应允许频道中的所有文本消息"),
]) as SchemaType<TriggerMode>;

export const Config: SchemaType<Config> = Schema.intersect([
  Schema.object({
    baseURL: Schema.string()
      .default("http://127.0.0.1:8787")
      .description("Harness 网关 Origin，不含路径"),
    messagePath: Schema.string()
      .default(DEFAULT_MESSAGE_PATH)
      .description("消息接口路径"),
    resetPath: Schema.string()
      .default(DEFAULT_RESET_PATH)
      .description("会话重置接口路径"),
    healthPath: Schema.string()
      .default(DEFAULT_HEALTH_PATH)
      .description("健康检查接口路径"),
    token: Schema.string()
      .role("secret")
      .description("网关 Bearer Token；留空时读取 tokenEnv"),
    tokenEnv: Schema.string()
      .default("DSH_KOISHI_TOKEN")
      .description("共享 Token 的环境变量名"),
    allowInsecureRemote: Schema.boolean()
      .default(false)
      .description(
        "允许用明文 HTTP 连接非本机地址；仅适用于已有可信隧道的部署",
      ),
  }).description("网关连接"),
  Schema.object({
    trigger: triggerSchema
      .default("direct-and-mention")
      .description("消息触发方式"),
    allowedChannels: Schema.array(
      Schema.object({
        platform: Schema.string()
          .required()
          .description("平台；* 匹配任意平台"),
        channelId: Schema.string()
          .required()
          .description("频道；* 匹配任意频道"),
        isDirect:
          Schema.boolean().description("是否限制为私聊；留空表示不限制"),
      }),
    )
      .role("table")
      .default([])
      .description("允许转发的频道；空数组默认拒绝全部"),
    maxInputChars: Schema.number()
      .min(1)
      .default(12_000)
      .description("本地接受的单条文本字符上限"),
  }).description("消息路由"),
  Schema.object({
    requestTimeoutMs: Schema.number()
      .min(1000)
      .role("ms")
      .default(195_000)
      .description("网关请求超时"),
    eagerCheck: Schema.boolean()
      .default(true)
      .description("插件启动时校验网关连接和 Token"),
  }).description("运行策略"),
  Schema.object({
    emptyReply: Schema.string().default("Harness 没有返回可发送的文本。"),
    busyReply: Schema.string().default("Harness 当前排队已满，请稍后再试。"),
    timeoutReply: Schema.string().default("Harness 本轮处理超时，请稍后再试。"),
    inputTooLongReply: Schema.string().default(
      "消息过长，当前最多接受 {limit} 个字符。",
    ),
    errorReply: Schema.string().default("Harness 网关暂时不可用，请稍后再试。"),
    resetReply: Schema.string().default("Harness 会话已重置。"),
    resetDeniedReply: Schema.string().default("当前频道未启用 Harness 网关。"),
  }).description("反馈文本"),
]) as SchemaType<Config>;

/** Resolve defaults and enforce transport safety for direct construction. */
export function resolveConfig(
  input: Config = {},
  env: NodeJS.ProcessEnv = process.env,
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

  const baseURL = normalizeBaseURL(
    input.baseURL,
    input.allowInsecureRemote ?? false,
  );
  const paths = [
    normalizePath(input.messagePath, DEFAULT_MESSAGE_PATH, "messagePath"),
    normalizePath(input.resetPath, DEFAULT_RESET_PATH, "resetPath"),
    normalizePath(input.healthPath, DEFAULT_HEALTH_PATH, "healthPath"),
  ] as const;
  if (new Set(paths).size !== paths.length)
    throw new Error("messagePath, resetPath, and healthPath must be distinct");

  return Object.freeze({
    baseURL,
    messagePath: paths[0],
    resetPath: paths[1],
    healthPath: paths[2],
    token,
    tokenEnv,
    allowInsecureRemote: input.allowInsecureRemote ?? false,
    trigger: input.trigger ?? "direct-and-mention",
    allowedChannels: Object.freeze(
      (input.allowedChannels ?? []).map(validateRule),
    ),
    maxInputChars: positiveInteger(
      input.maxInputChars,
      12_000,
      "maxInputChars",
    ),
    requestTimeoutMs: integerAtLeast(
      input.requestTimeoutMs,
      195_000,
      1000,
      "requestTimeoutMs",
    ),
    eagerCheck: input.eagerCheck ?? true,
    emptyReply: input.emptyReply ?? "Harness 没有返回可发送的文本。",
    busyReply: input.busyReply ?? "Harness 当前排队已满，请稍后再试。",
    timeoutReply: input.timeoutReply ?? "Harness 本轮处理超时，请稍后再试。",
    inputTooLongReply:
      input.inputTooLongReply ?? "消息过长，当前最多接受 {limit} 个字符。",
    errorReply: input.errorReply ?? "Harness 网关暂时不可用，请稍后再试。",
    resetReply: input.resetReply ?? "Harness 会话已重置。",
    resetDeniedReply: input.resetDeniedReply ?? "当前频道未启用 Harness 网关。",
  });
}

function normalizeBaseURL(
  value: string | undefined,
  allowInsecureRemote: boolean,
): string {
  const raw = value?.trim() || "http://127.0.0.1:8787";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("baseURL must be an absolute HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseURL must use http: or https:");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "baseURL must contain only scheme, host, and optional port",
    );
  }
  if (
    url.protocol === "http:" &&
    !isLoopback(url.hostname) &&
    !allowInsecureRemote
  ) {
    throw new Error(
      "plain HTTP is allowed only for loopback addresses unless allowInsecureRemote is true",
    );
  }
  return url.origin;
}

function normalizePath(
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

function isLoopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
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

function nonEmpty(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  return integerAtLeast(value, fallback, 1, field);
}

function integerAtLeast(
  value: number | undefined,
  fallback: number,
  minimum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw new Error(
      `${field} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
  return resolved;
}
