# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Planned

- 评估流式输出协议。
- 评估图片与其他 Koishi Element 的安全映射。
- 评估 Harness 持久 Session 恢复与持久幂等记录。

## [0.1.0] - 2026-08-14

### Added

- 新增 `dsh-plugin-koishi` Harness 侧网关包。
- 新增 `koishi-plugin-dsh-bridge` Koishi 伴侣包。
- 新增 Bearer Token、严格 JSON 协议、请求体与输入长度限制。
- 新增两端默认拒绝允许频道策略。
- 新增三种 Session Scope、每会话 FIFO、跨会话并行与全局会话上限。
- 新增超时取消、故障换代、空闲回收、手动重置和进程内请求去重。
- 新增 44 项单元、服务生命周期与无密钥 HTTP 端到端测试。
- 新增 CI、构建、publint、npm pack 清单与详细文档。

[Unreleased]: https://github.com/nazidada/dsh-plugin-koishi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nazidada/dsh-plugin-koishi/releases/tag/v0.1.0
