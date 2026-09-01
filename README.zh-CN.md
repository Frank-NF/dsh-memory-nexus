# dsh-memory-nexus

[English](./README.md) | 中文

DSH 一体化记忆与上下文管控增强插件，解决两大核心痛点：**长期对话记忆丢失、Token 超限爆炸**。

## 功能

- **四层记忆系统**：L1 运行记忆 / L2 情景记忆 / L3 语义记忆 / L4 程序记忆
- **上下文管控**：智能压缩、裁剪、冻结归档、重置会话
- **提示词编排**：统一调度记忆片段、系统提示词、MCP 工具定义
- **输入框 UI**：🗜️ 压缩按钮 + ✨ 增强提示词按钮

## 安装

```sh
dsh plugin --profile web add github:Frank-NF/dsh-memory-nexus
```

安装后重启 DSH Desktop 生效。

## 环境要求

- DSH Desktop（web profile），`dsh` CLI 可用
- 无额外依赖

## 许可

[MIT](./LICENSE)
