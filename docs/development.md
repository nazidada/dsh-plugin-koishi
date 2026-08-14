# 开发指南

## 1. 仓库结构

```text
dsh-plugin-koishi/
├── packages/
│   ├── dsh-plugin-koishi/
│   │   ├── src/
│   │   │   ├── config.ts        # DSH Schemastery 配置与直接构造校验
│   │   │   ├── protocol.ts      # 共享协议、解析器与响应守卫
│   │   │   ├── routing.ts       # allowlist、Scope、Session ID、Prompt
│   │   │   ├── session-pool.ts  # Agent Handle、FIFO、超时、去重、回收
│   │   │   ├── server.ts        # 鉴权 HTTP Listener
│   │   │   └── index.ts         # Harness Cordis Service
│   │   └── package.json
│   └── koishi-plugin-dsh-bridge/
│       ├── src/
│       │   ├── config.ts        # Koishi Schema 与传输安全校验
│       │   ├── routing.ts       # live Session 脱离与触发规则
│       │   ├── client.ts        # Fetch Client 与响应校验
│       │   ├── koishi.ts        # ESM/CJS Runtime Export 兼容层
│       │   ├── service.ts       # Middleware、Service、dsh.reset
│       │   └── index.ts
│       └── package.json
├── tests/                        # 跨包真实 HTTP 端到端测试
├── examples/                     # Harness 与 Koishi 配置示例
├── docs/                         # 架构、配置、部署、开发、排障
└── scripts/check-packages.mjs    # npm pack 文件清单门禁
```

## 2. 安装

```bash
npm ci --ignore-scripts
```

仓库使用 npm Workspaces 和提交的 `package-lock.json`。不要在一个改动中混用 npm、pnpm 与 Yarn 更新锁文件。

## 3. 验证命令

### 3.1 快速检查

```bash
npm run check-types
npm test
```

### 3.2 完整检查

```bash
npm run check
```

执行顺序：

1. `npm run lint`：Oxlint。
2. `npm run format:check`：Prettier 只读检查。
3. `npm run check-types`：TypeScript strict，不产出文件。
4. `npm test`：Vitest 无密钥测试。
5. `npm run build`：两个包的 pkgroll 产物。
6. `npm run publint`：导出与包元数据。
7. `npm run check:packages`：`npm pack --dry-run --json` 白名单检查。

### 3.3 覆盖率

```bash
npm run test:coverage
```

最低门槛：

- Statements 85%
- Branches 80%
- Functions 85%
- Lines 85%

覆盖率不是正确性的替代。协议、安全和并发改动要先设计拒绝路径，再看百分比。

### 3.4 依赖审计

如果本机 `.npmrc` 使用不提供 Audit API 的镜像，请显式切换到 npm 官方端点：

```bash
npm audit --omit=dev --registry=https://registry.npmjs.org
```

当前 Koishi Peer 依赖树有一个已记录的中危 `file-type` 上游公告。不要直接执行 `npm audit fix --force` 或把 `file-type` 跨主版本覆盖；现状、影响边界与升级条件见 [`SECURITY.md`](../SECURITY.md#当前上游公告)。

## 4. 测试分层

### 4.1 纯函数

- Protocol Parser 与 Response Guard。
- Allowlist、Session Scope、Session ID 和 Prompt 格式。
- Koishi 触发与 Session 脱离。

### 4.2 Session Pool

使用结构化 Fake Agent，不调用真实 Provider，覆盖：

- 同会话最大并行度为 1。
- 不同会话能同时运行。
- 同 Request ID 复用同一 Promise。
- 队列满时同步拒绝。
- 超时发出 Cancel 并 Dispose。
- Reset 后 Session ID 变化。
- 会话被容量回收后 Session ID 仍不复用。
- 去重缓存有硬上限且不会淘汰活动请求。
- 最终 Assistant 文本选择。

### 4.3 HTTP Server

绑定 `127.0.0.1:0` 的真实 Node Listener，覆盖：

- 401 鉴权。
- 405 Method。
- 413 Body Size。
- 415 Media Type。
- 429 Busy。
- Health、Message 与 Reset 正常路径。

### 4.4 双包端到端

`tests/bridge.integration.test.ts` 用真实 `GatewayServer` 和真实 `DshGatewayClient` 完成 HTTP 往返，确保两边协议常量、Header、响应校验和错误映射一致。

### 4.5 Koishi Service 与 Client

- 真实 Koishi `Context` 启动 Service，覆盖启动健康检查、中间件和 `dsh.reset`。
- Client 覆盖成功响应、协议错配、非 JSON、响应上限、429、504、通用 HTTP 错误、网络失败和本地 Abort 超时。

## 5. 构建产物

Harness 包：

- `dist/index.js`
- `dist/index.d.ts`
- `dist/protocol.js`
- `dist/protocol.d.ts`

Koishi 包：

- `dist/index.mjs`
- `dist/index.cjs`
- `dist/index.d.mts`
- `dist/index.d.cts`

实际导入验证：

```bash
node -e "import('./packages/dsh-plugin-koishi/dist/index.js').then(m => console.log(typeof m.default))"
node -e "import('./packages/koishi-plugin-dsh-bridge/dist/index.mjs').then(m => console.log(typeof m.default))"
node -e "console.log(typeof require('./packages/koishi-plugin-dsh-bridge/dist/index.cjs').default)"
```

## 6. 协议变更规则

兼容扩展不能直接放宽当前 Parser。变更前回答：

1. 旧 Client 调新 Server 是否工作？
2. 新 Client 调旧 Server 是否工作？
3. 新字段是可忽略信息，还是改变 Agent 输入/会话语义？
4. 是否需要新 Endpoint 或 `version: 2`？
5. Body、日志、隐私和幂等上限是否仍成立？

协议变更必须同时修改：

- 共享类型与 Parser。
- Server 与 Client。
- 两端测试和跨包测试。
- `docs/architecture.md`。
- `CHANGELOG.md`。

## 7. 依赖升级

DeepSeek Harness 是 RC 依赖。升级步骤：

1. 查询官方 npm Dist Tag 和源仓库对应提交。
2. 阅读 Agent、Session、LLM 与 Cordis 生命周期变更。
3. 同步所有 DSH Peer 与开发依赖版本。
4. 重新生成锁文件。
5. 运行完整检查和构建产物导入。
6. 用无工具 Runtime 做一次真实模型消息与 Reset。
7. 更新 `SOURCES.md` 与 Changelog。

Koishi 升级还要验证 `koishi.ts` 兼容层是否仍需要、ESM/CJS 两种导入是否成功。

## 8. 发布准备

当前项目只完成 GitHub 源码开源；未来发布 npm 时建议：

1. 确认工作树干净且 CI 通过。
2. 更新版本与 Changelog。
3. `npm ci --ignore-scripts`。
4. `npm run check`。
5. 分别发布 `dsh-plugin-koishi` 与 `koishi-plugin-dsh-bridge`；伴侣包已经内联协议，两者没有 Registry 安装顺序依赖。
6. 分别从 Registry 检查两个 Tarball 的文件清单与导出。
7. 从 Registry 新目录安装并做产物 Smoke。
8. 创建签名 Git Tag 与 GitHub Release。

不要在未验证的工作树直接运行 `npm publish`。
