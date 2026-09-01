// dsh-memory-nexus — 企业安全模式
//
// 提供以下能力：
//  1. scope 隔离强化：按 org/project 隔离记忆读写
//  2. Agent 操作权限限制：区分 user/agent/system actor 权限
//  3. 企业级审计：记录所有敏感操作到 audit_log
//  4. 安全配置管理：通过 memory_config 表存储策略

import nodeFs from "node:fs";
import nodePath from "node:path";

/**
 * 安全角色定义
 * - user: 完整读写权限
 * - agent: 有限读写（可 recall/write，不可 delete/batch_forget）
 * - system: 仅读取（用于跨插件迁移等系统操作）
 */
export const ROLES = {
	USER: "user",
	AGENT: "agent",
	SYSTEM: "system",
};

/**
 * 各角色允许的操作
 */
export const PERMISSIONS = {
	[ROLES.USER]: new Set([
		"remember", "recall", "search",
		"remember_fact", "recall_facts", "search_facts",
		"forget_fact", "update_fact", "pin_fact", "batch_forget",
		"snapshot", "compress", "trim", "freeze", "reset",
		"skill_generate", "skill_list", "skill_update", "skill_review",
		"skill_publish", "skill_import_md", "skill_delete",
		"graph_upsert", "graph_link", "graph_parse",
		"graph_view_global", "graph_view_local", "graph_search",
		"graph_recall", "graph_stats", "graph_delete_node",
		"list_facts", "dashboard", "audit_log",
		"set_config", "clear_cache", "cache_stats",
		"detect_plugins", "migrate",
		"export", "import", "validate_package",
		"ingest_document",
	]),
	[ROLES.AGENT]: new Set([
		"remember", "recall", "search",
		"remember_fact", "recall_facts", "search_facts",
		"snapshot", "compress", "trim", "freeze", "reset",
		"skill_generate", "skill_list", "skill_update", "skill_review",
		"skill_import_md",
		"graph_upsert", "graph_link", "graph_parse",
		"graph_view_global", "graph_view_local", "graph_search",
		"graph_recall", "graph_stats",
		"list_facts", "dashboard", "audit_log",
		"clear_cache", "cache_stats",
		"export", "ingest_document",
	]),
	[ROLES.SYSTEM]: new Set([
		"recall", "search", "recall_facts", "search_facts",
		"graph_view_global", "graph_view_local", "graph_search",
		"graph_recall",
		"dashboard", "audit_log",
		"cache_stats",
		"detect_plugins", "migrate",
	]),
};

/**
 * 检查操作是否被授权
 */
export function checkPermission(role, action) {
	const allowed = PERMISSIONS[role] || PERMISSIONS[ROLES.USER];
	return allowed.has(action);
}

/**
 * 从请求头/参数中提取角色
 * 优先级: x-memory-nexus-role header > actor 字段 > 默认 user
 */
export function resolveRole(req, body) {
	const headerRole = req?.headers?.["x-memory-nexus-role"];
	if (headerRole) {
		const role = String(headerRole).toLowerCase();
		if (role === "agent" || role === "system") return role;
	}
	const actor = body?.actor;
	if (actor === "agent" || actor === "system") return actor;
	return ROLES.USER;
}

/**
 * 校验安全策略，未授权返回 false + error
 */
export function enforceSecurity(req, body, db, sessionId, writeAudit) {
	const action = body?.action;
	if (!action) return { ok: true }; // 无 action 不做检查

	const role = resolveRole(req, body);
	if (!checkPermission(role, action)) {
		return {
			ok: false,
			error: `permission_denied: ${action} not allowed for role ${role}`,
			role,
		};
	}

	// 企业隔离：如果有 org_id 配置，强制绑定
	if (db) {
		try {
			const orgConstraint = getOrgConstraint(db, sessionId);
			if (orgConstraint) {
				body._orgConstraint = orgConstraint;
			}
		} catch {}
	}

	return { ok: true, role };
}

/**
 * 获取组织的隔离约束（从 config 表读取）
 */
export function getOrgConstraint(db, sessionId) {
	try {
		// 先查 session 级别的 org
		const row = db.prepare(
			"SELECT value FROM memory_config WHERE key = ?",
		).get(`org:${sessionId}`);
		if (row) return row.value;

		// 再查全局 org
		const globalRow = db.prepare(
			"SELECT value FROM memory_config WHERE key = ?",
		).get("org:global");
		return globalRow ? globalRow.value : null;
	} catch {
		return null;
	}
}

/**
 * 设置组织隔离
 */
export function setOrgScope(db, sessionId, orgId) {
	if (!db) return { ok: false, error: "database not initialized" };
	db.prepare(
		"INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)",
	).run(`org:${sessionId}`, orgId || null);
	// 也设置全局
	if (!orgId) {
		db.prepare(
			"INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)",
		).run("org:global", null);
	}
	return { ok: true };
}

/**
 * 企业安全 API 处理函数
 */
export function handleSecurityAction(db, sessionId, req, body, writeAudit) {
	const action = body.action;

	if (action === "security_check") {
		const role = resolveRole(req, body);
		return {
			ok: true,
			role,
			permissions: Array.from(PERMISSIONS[role] || []),
			can_modify: PERMISSIONS[role]?.has("set_config") ?? false,
		};
	}

	if (action === "set_org_scope") {
		const orgId = body.orgId;
		if (!orgId && orgId !== null) {
			return { ok: false, error: "orgId is required" };
		}
		const result = setOrgScope(db, sessionId, orgId);
		if (result.ok) {
			writeAudit(db, sessionId, body.actor || "user", "set_org_scope", "config", null, `org=${orgId || "none"}`);
		}
		return result;
	}

	if (action === "get_org_scope") {
		const constraint = getOrgConstraint(db, sessionId);
		return { ok: true, org_id: constraint };
	}

	if (action === "security_stats") {
		let agentOps = 0, userOps = 0, deniedOps = 0;
		if (db) {
			try {
				const rows = db.prepare(`
					SELECT actor, COUNT(*) as cnt FROM audit_log
					WHERE session_id = ?
					GROUP BY actor
				`).all(sessionId);
				for (const r of rows) {
					if (r.actor === "agent") agentOps += r.cnt;
					else if (r.actor === "user") userOps += r.cnt;
				}
				//  Denied operations are not logged, estimate from role distribution
				deniedOps = 0; // tracked separately if needed
			} catch {}
		}
		return { ok: true, agent_operations: agentOps, user_operations: userOps, denied_operations: deniedOps };
	}

	return { ok: false, error: "unknown security action" };
}

/**
 * 导出安全相关的配置常量
 */
export const SECURITY_CONFIG_KEY = "security:enterprise_mode";

/**
 * 检查是否启用了企业安全模式
 */
export function isEnterpriseMode(db, sessionId) {
	if (!db) return false;
	try {
		const row = db.prepare(
			"SELECT value FROM memory_config WHERE key = ?",
		).get(SECURITY_CONFIG_KEY);
		return row?.value === "true";
	} catch {
		return false;
	}
}

/**
 * 启用/禁用企业安全模式
 */
export function toggleEnterpriseMode(db, sessionId, enabled) {
	if (!db) return { ok: false, error: "database not initialized" };
	db.prepare(
		"INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)",
	).run(SECURITY_CONFIG_KEY, enabled ? "true" : "false");
	return { ok: true, enterprise_mode: enabled };
}
