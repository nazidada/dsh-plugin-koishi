/** Koishi companion plugin for dsh-plugin-koishi. */

export { DshBridgeService, DshBridgeService as default } from "./service.js";
export { Config, resolveConfig } from "./config.js";
export type {
  ChannelRule,
  Config as DshBridgeConfig,
  ResolvedConfig,
  TriggerMode,
} from "./config.js";
export * from "./client.js";
export * from "./routing.js";
