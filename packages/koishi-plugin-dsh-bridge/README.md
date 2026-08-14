# koishi-plugin-dsh-bridge

`dsh-plugin-koishi` 的 Koishi 伴侣插件。

它在 Koishi 中执行允许频道与触发判断，把 live `Session` 脱离为纯 JSON 请求，通过带 Bearer Token 的 HTTP(S) 调用 Harness 网关，并把最终文本作为被动回复返回。

完整项目、Harness 端包与文档：<https://github.com/nazidada/dsh-plugin-koishi>

## 兼容性

- Node.js `^22.19.0` 或 `>=24.0.0`
- Koishi `^4.18.11`
- 对端 `dsh-plugin-koishi` 协议版本 1

包同时提供 ESM、CommonJS 与对应 TypeScript 声明。
共享协议已经内联到构建产物；Koishi 应用不需要安装 Harness 端包，也不会加载其 Cordis Service。

## 从源码安装

```bash
git clone https://github.com/nazidada/dsh-plugin-koishi.git
cd dsh-plugin-koishi
npm ci --ignore-scripts
npm run build
cd /path/to/your-koishi-app
npm install /absolute/path/to/dsh-plugin-koishi/packages/koishi-plugin-dsh-bridge
```

## 最小配置

```yaml
plugins:
  dsh-bridge:
    baseURL: http://127.0.0.1:8787
    tokenEnv: DSH_KOISHI_TOKEN
    trigger: direct-and-mention
    allowedChannels:
      - platform: onebot
        channelId: "123456"
        isDirect: false
```

`allowedChannels` 为空时拒绝全部。默认 `eagerCheck: true`，应先启动 Harness 网关。

## 默认行为

- 私聊响应全部文本；群聊仅在机器人被点名时响应。
- 命令不会进入模型转发。
- `dsh.reset` 重置当前允许会话。
- 429 映射为忙碌提示，504/本地 Fetch 超时映射为超时提示。
- 非回环明文 HTTP 默认拒绝；远程部署使用 HTTPS 或可信隧道。

## Service API

插件提供 `ctx.dshBridge`：

```ts
const health = await ctx.dshBridge.health();
const reply = await ctx.dshBridge.send(detachedProtocolRequest);
```

完整配置、安全说明与排障见仓库根文档。许可证：MIT。
