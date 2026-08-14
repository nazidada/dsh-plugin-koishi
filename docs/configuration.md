# 配置参考

## 1. 配置原则

- Harness 与 Koishi 两端必须使用相同 Token。
- 两端 `allowedChannels` 都必须显式配置，建议内容一致。
- 两端三个 HTTP Path 必须一致。
- Koishi `requestTimeoutMs` 应大于 Harness `turnTimeoutMs`，默认多 15 秒。
- 普通聊天建议让 `workspacePath` 指向无敏感数据的专用目录，并在 Harness 组合中关闭高权限工具。

## 2. Harness 端 `dsh-plugin-koishi`

### 2.1 网络与协议

| 字段            | 类型      | 默认值                      | 说明                                   |
| --------------- | --------- | --------------------------- | -------------------------------------- |
| `host`          | `string`  | `127.0.0.1`                 | Listener 地址；远程部署前阅读安全指南  |
| `port`          | `integer` | `8787`                      | Listener 端口；`0` 仅适合测试随机端口  |
| `messagePath`   | `string`  | `/v1/koishi/messages`       | 消息端点，必须是绝对 Path              |
| `resetPath`     | `string`  | `/v1/koishi/sessions/reset` | 重置端点                               |
| `healthPath`    | `string`  | `/healthz`                  | 健康端点                               |
| `token`         | `string`  | 无                          | 直接配置 Token；不推荐写进版本控制文件 |
| `tokenEnv`      | `string`  | `DSH_KOISHI_TOKEN`          | `token` 为空时读取的环境变量           |
| `maxBodyBytes`  | `integer` | `131072`                    | HTTP 请求体字节上限，最小 1024         |
| `maxInputChars` | `integer` | `12000`                     | `message.text` 字符上限                |

`messagePath`、`resetPath` 和 `healthPath` 必须不同，不能包含 Query、Fragment、尾部重复斜线或空 Path Segment。

### 2.2 Agent 路由

| 字段                    | 类型            | 默认值              | 说明                               |
| ----------------------- | --------------- | ------------------- | ---------------------------------- |
| `provider`              | `string`        | `deepseek-official` | `agentOptions.provider`            |
| `model`                 | `string`        | `deepseek-v4-flash` | `agentOptions.model`               |
| `maxTokens`             | `integer`       | `8192`              | 单次模型请求最大输出 Token         |
| `workspacePath`         | `string`        | `.`                 | 解析为绝对路径后写入 Session `cwd` |
| `sessionScope`          | enum            | `channel`           | 会话隔离方式                       |
| `includeSenderInGroups` | `boolean`       | `true`              | 群聊模型输入是否附带发送者标签     |
| `allowedChannels`       | `ChannelRule[]` | `[]`                | 空数组拒绝全部                     |

### 2.3 队列、超时与回收

| 字段                         | 类型      | 默认值    | 说明                                                |
| ---------------------------- | --------- | --------- | --------------------------------------------------- |
| `turnTimeoutMs`              | `integer` | `180000`  | 整个 Agent 活动超时，最小 1000ms                    |
| `maxPendingPerSession`       | `integer` | `8`       | 单会话活动与排队任务总上限                          |
| `maxSessions`                | `integer` | `128`     | 进程内 Session Entry 上限                           |
| `idleTtlMs`                  | `integer` | `1800000` | 空闲回收 TTL；在后续请求到来时扫描                  |
| `dedupeTtlMs`                | `integer` | `300000`  | 相同 `requestId` 结果复用时间                       |
| `maxDedupeEntriesPerSession` | `integer` | `256`     | 每类去重记录上限，必须不小于 `maxPendingPerSession` |

消息与 Reset 分别使用一个去重 Map，因此最坏条目数约为字段值的两倍。TTL 从请求完成后开始计算；活动记录不会过期，也不会因容量被提前淘汰。

### 2.4 Harness 示例

```yaml
- id: koishi-gateway
  name: dsh-plugin-koishi
  config:
    host: 127.0.0.1
    port: 8787
    tokenEnv: DSH_KOISHI_TOKEN
    provider: deepseek-official
    model: deepseek-v4-flash
    maxTokens: 8192
    workspacePath: ./koishi-workspace
    sessionScope: channel
    includeSenderInGroups: true
    allowedChannels:
      - platform: onebot
        channelId: "123456"
        isDirect: false
    maxInputChars: 12000
    maxBodyBytes: 131072
    turnTimeoutMs: 180000
    maxPendingPerSession: 8
    maxSessions: 128
    idleTtlMs: 1800000
    dedupeTtlMs: 300000
    maxDedupeEntriesPerSession: 256
```

## 3. Koishi 端 `koishi-plugin-dsh-bridge`

### 3.1 连接

| 字段                  | 类型      | 默认值                      | 说明                                 |
| --------------------- | --------- | --------------------------- | ------------------------------------ |
| `baseURL`             | `string`  | `http://127.0.0.1:8787`     | 只含 Scheme、Host 和 Port 的 Origin  |
| `messagePath`         | `string`  | `/v1/koishi/messages`       | 必须与 Harness 一致                  |
| `resetPath`           | `string`  | `/v1/koishi/sessions/reset` | 必须与 Harness 一致                  |
| `healthPath`          | `string`  | `/healthz`                  | 必须与 Harness 一致                  |
| `token`               | `string`  | 无                          | Secret 字段；为空读取 `tokenEnv`     |
| `tokenEnv`            | `string`  | `DSH_KOISHI_TOKEN`          | Token 环境变量                       |
| `allowInsecureRemote` | `boolean` | `false`                     | 允许非回环 HTTP；仅在可信隧道内使用  |
| `requestTimeoutMs`    | `integer` | `195000`                    | Fetch 超时；应高于 Harness Turn 超时 |
| `eagerCheck`          | `boolean` | `true`                      | Service 启动时调用鉴权 Health        |

`baseURL` 不允许 Username、Password、Path、Query 或 Fragment。远程地址应使用 HTTPS；如果已有 VPN/SSH Tunnel 才考虑 `allowInsecureRemote: true`。

### 3.2 消息路由

| 字段              | 类型            | 默认值               | 说明                |
| ----------------- | --------------- | -------------------- | ------------------- |
| `trigger`         | enum            | `direct-and-mention` | 消息触发模式        |
| `allowedChannels` | `ChannelRule[]` | `[]`                 | 空数组拒绝全部      |
| `maxInputChars`   | `integer`       | `12000`              | HTTP 前本地字符上限 |

触发模式：

| 值                   | 私聊     | 群聊                        |
| -------------------- | -------- | --------------------------- |
| `direct-and-mention` | 全部文本 | 仅 `session.stripped.appel` |
| `mention`            | 仅点名   | 仅点名                      |
| `all`                | 全部文本 | 全部文本                    |

命令消息 `session.argv?.command` 不进入聊天转发，避免 `dsh.reset` 自己又触发模型。

### 3.3 用户反馈

| 字段                | 默认值                                    | 使用场景                   |
| ------------------- | ----------------------------------------- | -------------------------- |
| `emptyReply`        | `Harness 没有返回可发送的文本。`          | 最终 Assistant 无文本      |
| `busyReply`         | `Harness 当前排队已满，请稍后再试。`      | HTTP 429                   |
| `timeoutReply`      | `Harness 本轮处理超时，请稍后再试。`      | 本地 Fetch 超时或 HTTP 504 |
| `inputTooLongReply` | `消息过长，当前最多接受 {limit} 个字符。` | 本地长度拒绝               |
| `errorReply`        | `Harness 网关暂时不可用，请稍后再试。`    | 其他错误                   |
| `resetReply`        | `Harness 会话已重置。`                    | Reset 成功                 |
| `resetDeniedReply`  | `当前频道未启用 Harness 网关。`           | 当前会话不在允许列表       |

`inputTooLongReply` 中的 `{limit}` 会被替换为数值，其他反馈文本不做模板替换。

### 3.4 Koishi 示例

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
    maxInputChars: 12000
    requestTimeoutMs: 195000
    eagerCheck: true
```

## 4. ChannelRule

```ts
interface ChannelRule {
  platform: string;
  channelId: string;
  isDirect?: boolean;
}
```

匹配条件同时满足：

1. `rule.platform === '*'` 或等于会话平台。
2. `rule.channelId === '*'` 或等于会话频道。
3. `isDirect` 省略，或等于会话私聊状态。

多个规则按 OR 合并。没有隐式“允许所有”行为。

## 5. Session Scope

选择前考虑上下文泄露与群聊连贯性：

- `channel`：群内共享上下文，最适合普通群聊；同一用户在不同群不共享。
- `user`：用户跨频道共享，可能把一个频道的信息带到另一个频道，应谨慎使用。
- `channel-user`：群中每位用户独立，隐私隔离更强，但机器人不理解其他群成员的共同上下文。
