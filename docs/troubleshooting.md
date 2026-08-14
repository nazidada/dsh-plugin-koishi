# 故障排查

排查时不要把 Token、Authorization Header、完整消息正文或真实频道/用户 ID 粘贴到公开位置。

## 1. Koishi 启动时报 Gateway Health 失败

可能原因：

- Harness 尚未启动。
- `baseURL`、端口或 Path 不一致。
- 两端 Token 不同。
- Listener 只绑定另一种 IP 协议。
- 反向代理没有转发 Authorization Header。

检查：

```bash
curl --fail-with-body \
  -H "Authorization: Bearer ${DSH_KOISHI_TOKEN}" \
  http://127.0.0.1:8787/healthz
```

临时设置 `eagerCheck: false` 只能让 Koishi 启动，不会修复消息请求。推荐修复连接后恢复 `true`。

## 2. HTTP 401 `unauthorized`

检查：

1. 两个进程是否真的读取同一个 `tokenEnv`。
2. Environment 是否在进程启动前设置。
3. systemd/Docker 的环境与当前 Shell 是否不同。
4. Token 是否包含意外换行或首尾空格。
5. 反向代理是否删除或隐藏 Authorization Header。

轮换 Token 后两个进程都需要使用新值重启。

## 3. HTTP 403 `channel_denied`

Harness 端允许列表拒绝了 Koishi 已转发的请求。两端配置都检查：

- `platform` 大小写和适配器实际值。
- `channelId` 是否写成了 Guild ID。
- `isDirect` 是否与会话类型一致。
- YAML 数字 ID 是否加引号，避免类型或前导零变化。

可暂时使用显式 `*/*` 验证规则问题，但验证后应恢复最小范围。

## 4. 消息没有任何反应

检查顺序：

1. `allowedChannels` 是否为空；空数组拒绝全部。
2. 群聊是否点名机器人；默认 Trigger 不是 `all`。
3. 消息是否被 Koishi 解析成命令；命令不会进入 Bridge。
4. `session.stripped.content` 是否为空。
5. 其他高优先级中间件是否提前终止链。
6. Koishi 是否有可用 Bot，能否发送普通 Echo 回复。

## 5. HTTP 429 `gateway_busy`

含义可能是：

- 同一会话 `pending` 达到 `maxPendingPerSession`。
- `maxSessions` 已满，且所有 Entry 都在活动。
- 去重缓存达到上限且全部记录尚未完成。

处理：

- 等待当前回合完成后重试。
- 检查 Provider 延迟和超时设置。
- 确认是否有平台重放或消息风暴。
- 逐步调整上限，同时观察内存、Provider 限流和费用。
- 不要简单取消所有容量限制。

## 6. HTTP 504 或 `timeoutReply`

Harness Turn 超过 `turnTimeoutMs`，或 Koishi Fetch 超过 `requestTimeoutMs`。

建议：

1. 保持 Koishi Timeout 至少比 Harness Timeout 大 10–15 秒。
2. 检查 Provider 延迟和网络。
3. 检查 Agent 是否调用长时间工具。
4. 普通聊天 Runtime 关闭高延迟工具。
5. 超时后不用手动 Reset；Gateway 已淘汰旧 Agent，下一条消息自动使用新 Session。

如果 Koishi 本地先超时，但 Harness 仍在运行，Client 断开不会自动取消 Server 端模型回合；应让 Harness Timeout 更短来确保最终收敛。

## 7. 返回空回复提示

Gateway 只读取本次活动区间最后一个 `assistant/message` 中的 Text Block。以下情况会得到 `emptyReply`：

- 模型只生成非文本 Block。
- 最终 Step 是空的使用量消息。
- Harness 在没有最终 Assistant Text 时正常收敛。

查看 Harness Session 事件类型和 Provider 行为，但不要公开用户正文。

## 8. `no agent factory registered`

Harness 组合加载了 `dsh-plugin-koishi` 和 Agent Registry，但没有加载 Agent Loop/Factory。使用 Agent Spine，或确保 `@deepseek-ai/dsh-agent-loop` 已向 `ctx.agents` 注册 Factory。

## 9. `provider/model` 找不到

Gateway 的 `provider` / `model` 必须与宿主 LLM Adapter 注册一致。检查：

- Provider 插件是否已加载。
- Provider Route 是否为 `deepseek-official` 或你的自定义名。
- Model ID 是否在 Adapter 配置中。
- API Key 是否由 Provider 自己读取。

Gateway Token 与模型 API Key 无关。

## 10. Address already in use

端口 8787 已被其他进程占用：

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

确认进程身份后选择：

- 停止旧 Gateway。
- 为新 Gateway 配置不同端口，并同步 Koishi `baseURL`。

不要盲目终止未知进程。

## 11. Koishi ESM 导入错误

伴侣包内部通过 CommonJS Runtime Export 读取 Koishi `Schema` 与 `Service`，并同时发布 ESM/CJS 产物。如果仍报 Loader 初始化错误：

1. 确认使用构建后的 `dist`，不是直接让 Node 执行 `src/*.ts`。
2. 运行 `npm run build`。
3. 确认 Koishi 版本为 `^4.18.11`。
4. 分别运行 ESM 和 CJS 导入 Smoke（见开发指南）。
5. 删除旧本地安装并重新安装构建后的包目录。

## 12. Reset 没有效果

- 命令必须在允许频道中执行。
- Reset 进入同一 FIFO，会等待此前回合结束。
- 成功后 Health 的 Session 数不一定减少，因为 Entry 会保留并使用新代次。
- 后续回复仍涉及相似内容时，确认它不是系统提示或 Provider 自身行为。

## 13. 如何提供可公开的诊断信息

可以提供：

- 项目版本与 Node 版本。
- HTTP 状态和稳定 Error Code。
- Harness/Koishi 包版本。
- 脱敏后的配置字段名和布尔值。
- 日志中的短 Route Fingerprint 与 Error Name。

不要提供：

- Token/API Key。
- Authorization Header。
- 完整请求/响应正文。
- 真实用户、频道、群组 ID。
- 含私人信息的 Harness Session 日志。
