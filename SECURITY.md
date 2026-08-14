# 安全策略

## 支持版本

| 版本      | 安全更新 |
| --------- | -------- |
| `0.1.x`   | 支持     |
| `< 0.1.0` | 不支持   |

## 报告漏洞

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告功能。不要在公开 Issue、Discussion、PR、聊天群或日志片段中披露以下内容：

- 可复现的未修复漏洞。
- Bearer Token、API Key、Cookie 或 Authorization Header。
- 真实频道 ID、用户 ID 或包含私人内容的请求正文。
- Provider 返回的完整敏感错误。

报告建议包含：

1. 受影响版本和部署拓扑。
2. 前置条件与最小复现步骤。
3. 实际影响和最坏影响。
4. 你已经尝试的缓解措施。
5. 如有补丁，附上测试但不要公开推送漏洞分支。

维护者会尽快确认收到、评估严重性并协调修复与披露时间。

## 威胁模型

本项目假设：

- Koishi 与 Harness 进程由同一部署者或互相信任的部署者管理。
- 网络攻击者可能访问 Listener，因此每个已知接口都要求 Bearer Token。
- 平台消息、显示名、ID 和 HTTP JSON 都是不可信输入。
- Harness 模型与工具可能产生失败、长时间运行或有副作用的操作。
- 本项目不把 Bearer Token 当作细粒度用户授权；持有 Token 的客户端拥有配置允许范围内的网关调用能力。

本项目不防御已经获得 Harness 主机执行权限、能够读取进程环境或能够修改插件配置的攻击者。

## 部署基线

1. 默认保持 `host: 127.0.0.1`。
2. 使用 `openssl rand -hex 32` 或同等强度生成 Token。
3. Token 只通过环境或专用 Secret Manager 注入。
4. Harness 与 Koishi 两端配置相同且最小化的 `allowedChannels`。
5. 普通聊天 Runtime 不加载 Bash、文件写入、子代理或无人值守工具。
6. 跨主机必须使用 HTTPS、VPN 或 SSH Tunnel，并配置防火墙。
7. 不要把 `0.0.0.0:8787` 直接暴露到公网。
8. 定期轮换 Token；轮换时先更新两端 Secret，再按计划重启。
9. 运行依赖与安全检查，并关注 DeepSeek Harness RC 变更。

## Harness 工具权限

`dsh-plugin-koishi` 使用宿主 `ctx.agents`，不会替你限制已加载工具。如果 Harness 组合含有 Bash、文件系统、网络、MCP、子代理或审批绕过能力，聊天平台消息可能驱动这些能力。部署者必须独立审计：

- 工具是否需要保留。
- 工作目录与文件系统策略。
- 进程 sandbox。
- 审批策略和无人值守路径。
- 模型 Provider 与数据保留政策。
- 会话持久日志中可能保存的用户消息。

仓库示例默认关闭 Bash、Skill、Job 和 Goal 等工具，仅作为较小权限的聊天基线。

## 日志与隐私

- Gateway 不记录 Token、请求正文或原始平台 ID。
- 路由诊断使用 SHA-256 的短指纹，仅用于同一日志窗口内定位。
- Harness Session 日志仍会保存发送给模型的文本；这属于 Harness 数据面，不是传输日志。
- 开启第三方 Provider、Telemetry、反向代理访问日志或持久化后端时，应单独审查其数据政策。

## 依赖与供应链

- 仓库提交 `package-lock.json`。
- CI 与本地都使用 `npm ci --ignore-scripts`。
- 发布前运行 `npm audit --omit=dev`、`publint` 和 `npm pack --dry-run` 清单检查。
- 不接受把远程脚本直接管道给 Shell 的安装方式。

### 当前上游公告

截至 2026-08-14，使用 npm 官方 Registry 执行 `npm audit --omit=dev` 会报告 10 个中危条目、0 个高危和 0 个严重条目。这 10 个条目由同一条依赖链放大：Koishi `4.18.11` → `@cordisjs/plugin-http` `0.6.3` → `file-type` `16.5.4`，根公告是 [GHSA-5v7r-6r5c-r473 / CVE-2026-31808](https://github.com/advisories/GHSA-5v7r-6r5c-r473)。畸形 ASF 输入可能让文件类型检测进入无限循环。

处置状态：

1. 本项目桥接层只读取 Koishi 已提供的纯文本 `session.stripped.content`，不会把图片、音频、文件或任意 Buffer 交给 `file-type`。
2. 不能把这一点理解成整个 Koishi 宿主免疫；宿主加载的其他适配器或插件仍可能处理不可信媒体。
3. `file-type` 的修复版本是 `21.3.1`，但强制把 Koishi 当前依赖的 `16.5.4` 跨五个主版本覆盖为 `21.3.1` 会改变 API，不能作为经过验证的兼容修复。
4. npm Audit 建议回退到 Koishi `4.17.5`；该版本仍在报告的受影响范围内，因此本项目不会采用这个误导性的自动修复。
5. 在 Koishi/Cordis 发布兼容升级前，部署者应保持本插件的纯文本边界，审计其他媒体处理插件，并避免让不可信媒体进入同进程文件类型检测路径。

升级依赖时必须重新运行官方 Registry 审计，并在真实 Koishi 宿主中验证 ESM、CommonJS、消息与重置路径。维护者会在兼容上游修复可用后更新锁文件和本节。
