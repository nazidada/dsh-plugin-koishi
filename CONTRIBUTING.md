# 贡献指南

感谢你愿意改进 `dsh-plugin-koishi`。提交前请先阅读 [架构说明](./docs/architecture.md) 和 [安全策略](./SECURITY.md)。

## 开发环境

- Node.js `^22.19.0` 或 `>=24.0.0`
- npm `10.x`
- Git

首次安装：

```bash
npm ci --ignore-scripts
npm run check
```

## 工作范围

一个 Pull Request 应只解决一个清晰问题。请避免把行为变化、依赖升级、大范围格式改写和无关重构混在一起。

涉及协议、鉴权、允许频道、Session ID、队列、超时或日志的改动属于安全敏感改动，必须同时更新：

1. 对应源码与类型。
2. 正常路径和拒绝路径测试。
3. `docs/architecture.md` 或 `docs/configuration.md`。
4. `CHANGELOG.md` 的 Unreleased 部分。

## 常用命令

```bash
npm run lint
npm run format:check
npm run check-types
npm test
npm run test:coverage
npm run build
npm run publint
npm run check:packages
npm run check
```

## 测试要求

- 新行为至少增加一个正常路径测试。
- 输入、协议和安全策略还必须增加无效或拒绝路径测试。
- 并发改动应使用可控 Promise/Barrier，不使用长时间 sleep。
- 不需要真实 API Key 的测试必须保持无密钥可运行。
- 真实模型测试如未来加入，默认必须自跳过且不得进入基础 CI。

## 代码规范

- TypeScript strict，不使用未解释的 `any`。
- ESM 源码的本地相对导入使用 `.js` 后缀。
- 输入只在明确的外部边界做运行时校验；同进程类型边界依赖 TypeScript。
- 注册副作用必须由宿主 Service 生命周期或 disposer 管理。
- 日志不得包含 Token、Authorization Header、完整消息正文或原始用户/频道 ID。
- 错误响应不得包含堆栈和 Provider 原始错误正文。

## Commit 与 Pull Request

推荐 Conventional Commits：

```text
feat(gateway): 增加会话回收策略
fix(koishi): 修复群聊点名判断
docs: 补充远程部署说明
test(protocol): 覆盖未知字段拒绝
```

Pull Request 描述应列出：

- 改了什么。
- 为什么需要。
- 用户或部署影响。
- 运行过的检查。
- 剩余风险或兼容性说明。

## 安全问题

不要为未公开漏洞创建公开 Issue。请按照 [SECURITY.md](./SECURITY.md) 使用 GitHub Private Vulnerability Reporting。
