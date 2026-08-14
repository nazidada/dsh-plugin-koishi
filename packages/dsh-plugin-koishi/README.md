# dsh-plugin-koishi

DeepSeek Harness 侧的 Koishi 消息网关插件。

它向现有 Harness Runtime 注入一个带 Bearer Token 的 HTTP Listener，并通过宿主 `ctx.agents` 为允许的 Koishi 会话创建 Agent。功能包括严格协议校验、双重允许频道、每会话 FIFO、请求去重、超时取消、全局容量、空闲回收与重置。

完整项目、Koishi 伴侣包与文档：<https://github.com/nazidada/dsh-plugin-koishi>

## 兼容性

- Node.js `^22.19.0` 或 `>=24.0.0`
- `@deepseek-ai/cordis` `4.0.1`
- DeepSeek Harness `0.1.0-rc.6`

Harness 框架依赖声明为精确 Peer，避免在插件内装入第二套运行时。实际运行宿主还必须配置可用的 Agent Registry、Agent Factory 与 LLM Provider。

## 从源码安装

```bash
git clone https://github.com/nazidada/dsh-plugin-koishi.git
cd dsh-plugin-koishi
npm ci --ignore-scripts
npm run build
npm install /absolute/path/to/dsh-plugin-koishi/packages/dsh-plugin-koishi
```

## 最小配置

```yaml
- id: koishi-gateway
  name: dsh-plugin-koishi
  config:
    host: 127.0.0.1
    port: 8787
    tokenEnv: DSH_KOISHI_TOKEN
    provider: deepseek-official
    model: deepseek-v4-flash
    allowedChannels:
      - platform: onebot
        channelId: "123456"
        isDirect: false
```

`allowedChannels` 默认为空并拒绝全部。共享 Token 至少 32 个字符，推荐使用 `openssl rand -hex 32` 生成并通过环境注入。

## Service API

插件提供 `ctx.koishiGateway`：

```ts
const stats = ctx.koishiGateway.stats();
const origin = ctx.koishiGateway.address();
```

`dispatch()` 与 `reset()` 也公开给同进程受信任插件，但调用方必须传入 `dsh-plugin-koishi/protocol` 定义的已验证对象；普通 Koishi 部署应使用伴侣包和 HTTP 边界。

## 安全提醒

网关 Agent 继承宿主 Harness 组合的全部工具。聊天部署应关闭不需要的 Bash、文件写入、MCP、网络与子代理能力，或独立配置 sandbox 与审批。

配置字段、部署步骤和协议见仓库根文档。许可证：MIT。
