#!/usr/bin/env node

import { Context } from "@deepseek-ai/cordis";
import * as AgentSpine from "@deepseek-ai/dsh-agent-spine-demo";
import * as LlmDeepSeek from "@deepseek-ai/dsh-llm-deepseek";
import KoishiGateway from "dsh-plugin-koishi";

const platform = process.env.KOISHI_PLATFORM?.trim();
const channelId = process.env.KOISHI_CHANNEL_ID?.trim();
if (!platform || !channelId) {
  throw new Error("set KOISHI_PLATFORM and KOISHI_CHANNEL_ID before starting");
}

const ctx = new Context();
let stopping;

async function stop(exitCode) {
  stopping ??= ctx.fiber.dispose().finally(() => {
    process.exitCode = exitCode;
  });
  await stopping;
}

process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(0));

try {
  await ctx.plugin(AgentSpine, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona:
      "你是一个由 DeepSeek Harness 驱动的 Koishi 聊天助手。请直接、准确且友善地回答。",
    workspaceContext: false,
    skills: { enabled: false },
    toolBash: false,
    toolJobs: false,
    goals: false,
  });
  await ctx.plugin(LlmDeepSeek, { apiKeyEnv: "DEEPSEEK_API_KEY" });
  await ctx.plugin(KoishiGateway, {
    host: "127.0.0.1",
    port: 8787,
    tokenEnv: "DSH_KOISHI_TOKEN",
    provider: "deepseek-official",
    model: "deepseek-v4-flash",
    workspacePath: process.cwd(),
    sessionScope: "channel",
    allowedChannels: [{ platform, channelId }],
  });
} catch (error) {
  process.stderr.write(
    `dsh-plugin-koishi example failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  await stop(1);
}
