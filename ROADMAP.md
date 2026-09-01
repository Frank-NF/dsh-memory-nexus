# dsh-memory-nexus 开发路线图

## P0 最小可用版本（当前阶段）

### 核心功能
1. **L2 情景记忆**（SQLite FTS5）
   - `episodic` 表：会话日志原始记录
   - FTS5 虚拟表绑定，支持全文检索
   - 基础工具：`memory_remember()` / `memory_recall()`

2. **Nexus-Context 上下文管控**
   - 智能压缩（保留最近 N 轮，历史摘要）
   - 裁剪旧消息
   - 快照备份（破坏性操作前置）
   - Token 统计与告警

3. **输入框 UI**
   - 🗜️ 压缩按钮（下拉菜单）
   - 状态驱动颜色（灰/橙/红）

### 架构
- host half: `lib/index.js`（Cordis 插件，HTTP API）
- client half: `lib/client.js`（React 组件）
- 数据：SQLite + FTS5

---

## P1 体验增强

1. **L3 语义记忆**
   - `semantic` 表 + `semantic_version` 版本链
   - TTL 衰减规则
   - 冲突合并算法

2. **Nexus-Prompt 编排层**
   - agent/pre-step 钩子注入记忆
   - Token 预算管控
   - 结构化 prompt 输出

3. **输入框 ✨ 增强提示词按钮**
   - 查看召回记忆片段
   - 配置面板入口

4. **冻结历史**
   - 导出 `会话-归档.md`
   - 上下文保留引用标记

---

## P2 高阶功能

1. **L4 程序记忆**
   - Skill 草稿生成与审核面板
   - 对接 dsh-drop-md 拖拽插件

2. **知识图谱**
   - `graph_node` / `graph_edge` 表
   - Obsidian 双向链接
   - 图谱可视化

3. **记忆可视化面板**
   - 仪表盘（四层统计、数据库大小）
   - 记忆编辑、置顶、批量遗忘
   - 审计日志

---

## P3 生态打通

1. **PluginUpdater 集成**
   - 插件上架市场
   - Bundle 预装
   - 环境快照保存

2. **备份迁移**
   - 记忆导出/导入
   - 离线迁移支持

3. **企业安全模式**
   - scope 隔离强化
   - Agent 操作权限限制

---

## P3 生态打通（已完成）

### 1. 企业安全模式 ✅
- 角色权限系统：USER / AGENT / SYSTEM 三级权限
- 组织隔离：按 org_id 隔离记忆读写
- 企业模式开关：toggle_enterprise_mode / isEnterpriseMode
- UI 面板：🔒 安全模式按钮（order 13）+ 安全配置面板

### 2. PluginUpdater 环境快照 ✅
- saveEnvironmentSnapshot：保存当前插件/配置/记忆状态
- listEnvironmentSnapshots：列出所有快照
- restoreEnvironmentSnapshot：恢复快照配置
- deleteEnvironmentSnapshot：删除快照
- API 动作：save_environment_snapshot / list_snapshots / restore_snapshot / delete_snapshot

### 3. 备份迁移 ✅
- export：JSON / Markdown 格式导出
- import：JSON 导入，支持 conflict: skip/overwrite/merge
- validate_package：验证迁移包完整性
- API 动作：export / import / validate_package

---

## 当前进度

| 模块 | 状态 |
|------|------|
| L2 情景记忆 | ✅ 完成 |
| Nexus-Context | 🔄 部分完成（压缩/裁剪需对接会话API） |
| 输入框 UI | ✅ 完成 |
| L3 语义记忆 | ✅ 完成 |
| Nexus-Prompt | ✅ 完成 |
| L4 程序记忆 | ✅ 完成 |
| 知识图谱 | ✅ 完成 |
| 仪表盘 | ✅ 完成 |
| 跨插件迁移 | ✅ 完成 |
| 省 TOKEN 缓存 | ✅ 完成 |
| 企业安全模式 | ✅ 完成 |
| 环境快照 | ✅ 完成 |
| 备份迁移 | ✅ 完成 |

## 测试状态

- `tests/p2.test.mjs`：98 项全部通过 ✅
- `tests/host.test.cjs`：通过 ✅

## Git 提交历史

- `xxx` P3完成：企业安全模式 + 环境快照 + 测试覆盖
- `834c3c4` 跨插件迁移（detect + import from memoir/auto-memory/WorkBuddy）
- `39c3ab0` 省 TOKEN 缓存（recalls/token-estimate stats cache）
- `7897c79` P2完成：L4程序记忆、知识图谱、记忆管理面板、仪表盘 + 缺陷修复
- `4dc6424` 完善✨增强提示词按钮：召回展示、状态标记、点击外部关闭
- `8e92c68` P1完成：L3语义记忆、Nexus-Prompt编排层
- `f0f0a5d` 完善冻结导出和统计功能
- `f422b35` P0开发完成：L2情景记忆、Nexus-Context、输入框UI按钮
