# 参考来源与版本记录

本项目在 2026-08-14 依据以下本地源项目进行接口与架构研究。所有主要参考项目均使用 MIT License。本项目通过公开接口和设计原则独立实现，没有复制大段源码；仓库自身使用 MIT License。

## 1. DeepSeek Harness

- 仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 本地提交：`47f943859bef60e4160492346772ded9b24f765a`
- 参考包版本：npm `next` 标签 `0.1.0-rc.6`
- 重点文件：
  - `AGENTS.md`
  - `docs/architecture.md`
  - `packages/README.md`
  - `packages/core/agent/README.md`
  - `packages/core/agent/src/index.ts`
  - `packages/core/agent/src/runtime-types.ts`
  - `packages/core/session/src/index.ts`
  - `packages/core/session/src/types.ts`
  - `packages/llm/llm/src/message.ts`
  - `packages/examples/agent-spine-demo/src/index.ts`
  - `packages/sdk/client/src/api.ts`
  - `packages/host/webserver/src/index.ts`
- 采用的设计依据：
  - Cordis Service 与 Effect 生命周期。
  - `ctx.agents.create()` / `AgentHandle.dispose()` 所有权。
  - `agent.followup()`、`agent.whenIdle()` 和取消语义。
  - Session 事件日志与 `assistant/message` 最终文本。
  - 运行时输入必须成为可重建的日志事实。

## 2. Koishi

- 仓库：<https://github.com/koishijs/koishi>
- 本地提交：`fb6e2c092242c0387f07f36e21082d5715c48449`
- 参考版本：`4.18.11`
- 重点文件：
  - `packages/koishi/package.json`
  - `packages/core/src/session.ts`
  - `packages/core/src/middleware.ts`
  - `packages/core/src/context.ts`
  - `packages/core/src/command/index.ts`
  - `plugins/common/bind/src/index.ts`
- 采用的设计依据：
  - `ctx.middleware()` 的接入与 `next()` 委托。
  - `session.stripped.content` / `appel` / `atSelf`。
  - Koishi `Schema` 和 `Service` 插件结构。
  - 中间件返回值作为被动回复。

## 3. YesImBot / Athena v4

- 仓库：<https://github.com/YesWeAreBot/YesImBot>
- 本地提交：`e80105abd8e088f76e1375ad611bcdfaaea5c26e`
- 参考分支：`dev`
- 重点文件：
  - `AGENTS.md`
  - `README.md`
  - `core/src/config.ts`
  - `core/src/messengers/index.ts`
  - `core/src/channels/index.ts`
  - `core/src/runtimes/channel.ts`
  - `core/src/service.ts`
- 采用的设计依据：
  - live Koishi Session 不跨越运行时边界长期保存。
  - 稳定频道事实与平台对象分离。
  - `allowedChannels` 空数组默认拒绝。
  - 同一频道 FIFO、不同频道独立运行。
  - 故障日志不包含密钥和完整用户输入。

## 4. 对照项目

- 仓库：<https://github.com/nazidada/koishi-plugin-adapter-harness>
- 本地提交：`f380e025c39cf8ef4a4ec76252aff51e56ca6bf0`
- 用途：确认第二个项目不重复“Koishi 启动 Harness JSON-RPC 子进程”的所有权方向。
- 本项目的主要接口依据仍然是上面的三个源项目。

## 5. 兼容性说明

- DeepSeek Harness 的本地源码提交与 npm RC 发布元数据可能存在版本字段差异；项目实际安装和类型验证使用 `0.1.0-rc.6`。
- Koishi 伴侣包通过 CommonJS Runtime Export 兼容层读取 `Schema` 与 `Service`，避免在纯 ESM 库导入时提前执行 Koishi 应用 Loader。
- 升级任一主要 Peer 版本时，应重新检查上述文件和完整验证矩阵，而不是只修改版本号。
