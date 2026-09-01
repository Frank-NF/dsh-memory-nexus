// dsh-memory-nexus — host half (Cordis plugin, ESM).
// Exposes a same-origin HTTP API for the browser client half:
//   POST /api/memory-nexus  { action: "remember" | "recall" | "compress" | "trim" | "freeze" | "reset" | "snapshot" | "stats", ... }
//
// L2 情景记忆：SQLite FTS5，会话日志原始记录
// L3 语义记忆：事实/偏好/教训，TTL 衰减 + 版本链
// L4 程序记忆：Skill 草稿生成 → 审核 → 发布
// 知识图谱：节点/边 + [[双向链接]] + 邻域召回
// Nexus-Context：上下文压缩、裁剪、快照备份、冻结归档
//
// 安全设计：同 origin HTTP 路由，loopback 校验，拒绝跨站请求

import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeOs from "node:os";
import { createRequire } from "node:module";

import * as L4 from "./l4-skill.js";
import * as Graph from "./graph.js";
import * as Admin from "./memory-admin.js";
import { calculateTTLSeconds } from "./ttl.js";
import { initDatabase } from "./schema.js";
import { writeAudit, getAuditLog } from "./audit.js";
import { estimateTokens, ingestDocument } from "./ingest.js";
import { nexusCache } from "./cache.js";
import { recallCacheKey, buildPromptCacheKey, statsCacheKey, tokenEstimateCache } from "./token-optimizer.js";
import { migrateFromOtherPlugins, detectMemoryPlugins } from "./migration.js";
import { handleExport, handleImport, validateMigrationPackage } from "./backup.js";
import { enforceSecurity, handleSecurityAction, isEnterpriseMode } from "./security.js";

const CACHE_TTL_MS = 30_000; // 召回/统计缓存 TTL 30 秒

// ESM 下没有全局 require，用 createRequire 取得一个可用的 CJS 加载器
// （better-sqlite3 是原生 CJS 模块，只能这样同步加载）
const require = createRequire(import.meta.url);

const PACKAGE_NAME = "dsh-memory-nexus";
const ROUTE_PATH = "/api/memory-nexus";
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
// 上下文预算（tokens）。DSH 真实用量由 cost-meter 提供，接入前用累计记忆 token 估算占用率
const DEFAULT_CONTEXT_BUDGET = 128000;

export const inject = ["fs"];

// 注意：better-sqlite3 是同步 C++ 模块，通过动态 require 加载
function loadSqlite() {
	try {
		// 尝试从不同路径加载
		const paths = [
			"C:/Users/niufe/.workbuddy/binaries/node/workspace/node_modules/better-sqlite3",
			"./node_modules/better-sqlite3",
		];
		for (const p of paths) {
			try {
				return require(p);
			} catch {}
		}
	} catch {}
	return null;
}

const Sqlite = loadSqlite();

function isLoopbackHostname(hostname) {
	const h = String(hostname).toLowerCase();
	return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

function parseAuthority(host) {
	const raw = String(host);
	const at = raw.lastIndexOf(":");
	if (raw.startsWith("[")) {
		const end = raw.indexOf("]");
		if (end === -1) return null;
		return { hostname: raw.slice(1, end), host: raw };
	}
	if (at === -1) return { hostname: raw, host: raw };
	const hostname = raw.slice(0, at);
	if (!/^\d{1,3}(\.\d{1,3}){1,3}$/.test(hostname) && hostname !== "localhost") return null;
	return { hostname, host: raw };
}

function header(headers, name) {
	const value = headers[name];
	return Array.isArray(value) ? value[0] : value;
}

function isTrustedRequest(req) {
	const host = header(req.headers, "host");
	if (host === undefined) return false;
	const authority = parseAuthority(host);
	if (authority === null) return false;
	if (!isLoopbackHostname(authority.hostname)) return false;
	if (String(header(req.headers, "sec-fetch-site") ?? "").toLowerCase() === "cross-site") return false;
	const origin = header(req.headers, "origin");
	if (origin === undefined) return true;
	try {
		return new URL(String(origin)).host === authority.host;
	} catch {
		return false;
	}
}

function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(payload);
}

async function readJsonBody(req) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw new Error("payload too large");
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.length === 0) return {};
	return JSON.parse(text);
}

// ============== SQLite 数据库管理 ==============

const DB_FILENAME = "memory-nexus.db";

// 获取数据库路径（持久化到 DSH home）
async function getDbPath(ctx, cwd) {
	const sp = ctx.get("sessionPersistence");
	if (sp && cwd) {
		try {
			const sessions = ctx.get("sessions");
			if (sessions && typeof sessions.get === "function") {
				const session = sessions.get(cwd);
				if (session) {
					const loc = sp.locate(session.header);
					if (loc && loc.path) {
						return loc.path + "/" + DB_FILENAME;
					}
				}
			}
		} catch {}
	}
	// fallback：工作目录
	return cwd + "/" + DB_FILENAME;
}

// ============== L2 情景记忆工具 ==============

async function rememberMessage(ctx, db, sessionId, role, content, tokenCount = 0) {
	if (!db) return { ok: false, error: "database not initialized" };

	const stmt = db.prepare(`
		INSERT INTO episodic (session_id, timestamp, role, content, token_count)
		VALUES (?, ?, ?, ?, ?)
	`);
	const info = stmt.run(sessionId, Date.now(), role, content, tokenCount);
	return { ok: true, id: info.lastInsertRowid };
}

async function recallMessages(ctx, db, sessionId, limit = 20) {
	if (!db) return { messages: [], total: 0, error: "database not initialized" };

	const stmt = db.prepare(`
		SELECT id, session_id, timestamp, role, content, token_count
		FROM episodic
		WHERE session_id = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`);
	const rows = stmt.all(sessionId, limit);
	return {
		messages: rows.map(r => ({
			id: r.id,
			session_id: r.session_id,
			timestamp: r.timestamp,
			role: r.role,
			content: r.content,
			token_count: r.token_count,
		})),
		total: rows.length,
	};
}

async function searchMessages(ctx, db, query, limit = 20) {
	if (!db) return { messages: [], total: 0, error: "database not initialized" };

	const stmt = db.prepare(`
		SELECT e.id, e.session_id, e.timestamp, e.role, e.content, e.token_count, f.rank
		FROM episodic_fts f
		JOIN episodic e ON e.id = f.rowid
		WHERE episodic_fts MATCH ?
		ORDER BY rank
		LIMIT ?
	`);
	const rows = stmt.all(query, limit);
	return {
		messages: rows.map(r => ({
			id: r.id,
			session_id: r.session_id,
			timestamp: r.timestamp,
			role: r.role,
			content: r.content,
			token_count: r.token_count,
		})),
		total: rows.length,
	};
}

// ============== L3 语义记忆工具 ==============

async function rememberFact(ctx, db, sessionId, content, kind = 'fact', importance = 0.5, tags = []) {
	if (!db) return { ok: false, error: "数据库未初始化" };

	const now = Date.now();
	const expiresAt = calculateTTL(kind, now);

	// 检查是否已有相似记忆（冲突检测）
	const existing = db.prepare(`
		SELECT id, content, version FROM semantic
		WHERE session_id = ? AND kind = ? AND content = ?
		LIMIT 1
	`).get(sessionId, kind, content);

	if (existing) {
		// 更新现有记录
		db.prepare(`
			UPDATE semantic SET updated_at = ?, version = version + 1, expires_at = ?
			WHERE id = ?
		`).run(now, expiresAt, existing.id);

		// 记录版本
		db.prepare(`
			INSERT INTO semantic_version (semantic_id, version, content, change_type, changed_at)
			VALUES (?, ?, ?, 'update', ?)
		`).run(existing.id, existing.version + 1, content, now);

		return { ok: true, id: existing.id, action: "updated" };
	}

	// 插入新记录
	const stmt = db.prepare(`
		INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);
	const info = stmt.run(sessionId, content, kind, importance, JSON.stringify(tags), now, now, expiresAt);

	// 记录初始版本
	db.prepare(`
		INSERT INTO semantic_version (semantic_id, version, content, change_type, changed_at)
		VALUES (?, 1, ?, 'create', ?)
	`).run(info.lastInsertRowid, content, now);

	return { ok: true, id: info.lastInsertRowid, action: "created" };
}

async function recallFacts(ctx, db, sessionId, limit = 20, kind = null) {
	if (!db) return { facts: [], total: 0, error: "database not initialized" };

	const now = Date.now();
	let sql = `
		SELECT id, session_id, content, kind, importance, tags, created_at, updated_at, expires_at,
		       COALESCE(pinned, 0) AS pinned
		FROM semantic
		WHERE session_id = ? AND (expires_at IS NULL OR expires_at > ?)
	`;
	const params = [sessionId, now];

	if (kind) {
		sql += " AND kind = ?";
		params.push(kind);
	}

	// 置顶记忆永远排在最前，其余按重要性 + 新鲜度
	sql += " ORDER BY COALESCE(pinned, 0) DESC, importance DESC, updated_at DESC LIMIT ?";
	params.push(limit);

	const stmt = db.prepare(sql);
	const rows = stmt.all(...params);

	return {
		facts: rows.map(r => ({
			id: r.id,
			session_id: r.session_id,
			content: r.content,
			kind: r.kind,
			importance: r.importance,
			pinned: !!r.pinned,
			tags: JSON.parse(r.tags || '[]'),
			created_at: r.created_at,
			updated_at: r.updated_at,
			expires_at: r.expires_at,
		})),
		total: rows.length,
	};
}

async function searchFacts(ctx, db, sessionId, query, limit = 20) {
	if (!db) return { facts: [], total: 0, error: "database not initialized" };
	if (!query) return recallFacts(ctx, db, sessionId, limit, null);

	const now = Date.now();
	// 跨会话检索：同会话的命中优先排前
	const stmt = db.prepare(`
		SELECT s.id, s.session_id, s.content, s.kind, s.importance, s.tags,
		       s.created_at, s.updated_at, s.expires_at, f.rank,
		       CASE WHEN s.session_id = ? THEN 1 ELSE 0 END AS same_session
		FROM semantic_fts f
		JOIN semantic s ON s.id = f.rowid
		WHERE semantic_fts MATCH ?
		  AND (s.expires_at IS NULL OR s.expires_at > ?)
		ORDER BY same_session DESC, rank
		LIMIT ?
	`);
	let rows;
	try {
		rows = stmt.all(sessionId || "", query, now, limit);
	} catch (e) {
		// FTS 语法错误（如裸通配符）时退化为 LIKE 模糊匹配
		const like = "%" + String(query).replace(/[%_]/g, (m) => "\\" + m) + "%";
		rows = db.prepare(`
			SELECT s.id, s.session_id, s.content, s.kind, s.importance, s.tags,
			       s.created_at, s.updated_at, s.expires_at, 0 AS rank
			FROM semantic s
			WHERE s.content LIKE ? ESCAPE '\\'
			  AND (s.expires_at IS NULL OR s.expires_at > ?)
			ORDER BY s.importance DESC, s.updated_at DESC
			LIMIT ?
		`).all(like, now, limit);
	}

	return {
		facts: rows.map(r => ({
			id: r.id,
			session_id: r.session_id,
			content: r.content,
			kind: r.kind,
			importance: r.importance,
			tags: JSON.parse(r.tags || '[]'),
			created_at: r.created_at,
			updated_at: r.updated_at,
			expires_at: r.expires_at,
		})),
		total: rows.length,
	};
}

async function forgetFact(ctx, db, factId) {
	if (!db) return { ok: false, error: "database not initialized" };

	const fact = db.prepare("SELECT id, content FROM semantic WHERE id = ?").get(factId);
	if (!fact) return { ok: false, error: "记忆不存在" };

	// 记录删除前的内容到版本表
	db.prepare(`
		INSERT INTO semantic_version (semantic_id, version, content, change_type, changed_at)
		SELECT id, version, content, 'delete', ? FROM semantic WHERE id = ?
	`).run(Date.now(), factId);

	// 删除记忆
	db.prepare("DELETE FROM semantic WHERE id = ?").run(factId);

	return { ok: true, deleted_id: factId, deleted_content: fact.content };
}

function calculateTTL(kind, now) {
	return calculateTTLSeconds(kind, now);
}

// ============== Nexus-Context 上下文管控 ==============

async function snapshotContext(ctx, db, sessionId, description) {
	if (!db) return { ok: false, error: "数据库未初始化" };

	// 记录快照前的记忆状态
	const beforeCount = db.prepare("SELECT COUNT(*) as count FROM episodic WHERE session_id = ?").get(sessionId);
	const beforeTokens = db.prepare("SELECT SUM(token_count) as total FROM episodic WHERE session_id = ?").get(sessionId);

	const stmt = db.prepare(`
		INSERT INTO snapshots (session_id, timestamp, before_state, description)
		VALUES (?, ?, ?, ?)
	`);
	const info = stmt.run(
		sessionId,
		Date.now(),
		JSON.stringify({
			message_count: beforeCount.count,
			token_count: beforeTokens.total || 0,
			timestamp: Date.now()
		}),
		description || "自动快照"
	);
	return {
		ok: true,
		snapshot_id: info.lastInsertRowid,
		before_state: {
			messages: beforeCount.count,
			tokens: beforeTokens.total || 0
		}
	};
}

async function compressContext(ctx, sessionId, keepRecentRounds = 8) {
	// 占位实现：实际压缩需要读取会话历史并调用 LLM 做摘要
	return {
		ok: true,
		message: "压缩功能开发中",
		kept_rounds: keepRecentRounds,
		original_tokens: 0,
		compressed_tokens: 0,
	};
}

async function trimContext(ctx, sessionId, keepRecentRounds = 8) {
	// 占位实现：实际裁剪需要操作会话消息列表
	return {
		ok: true,
		message: "裁剪功能开发中",
		kept_rounds: keepRecentRounds,
		removed_count: 0,
	};
}

async function freezeHistory(ctx, sessionId, description = "历史冻结") {
	// 获取记忆数据用于导出
	const exportData = await recallMessages(ctx, _db, sessionId, 1000);

	if (!exportData.messages || exportData.messages.length === 0) {
		return { ok: false, error: "无可用记忆数据" };
	}

	// recallMessages 是倒序（最新在前），导出需按时间正序
	const messages = exportData.messages.slice().sort((a, b) => a.timestamp - b.timestamp);

	// 构建 Markdown 内容
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const fileName = `会话归档-${sessionId}-${timestamp}.md`;
	// _dbPath 存的是工作目录本身，导出目录固定在工作目录下的 .dsh-memory-nexus
	const exportDir = nodePath.join(_dbPath || ".", ".dsh-memory-nexus");

	// 确保目录存在
	if (!nodeFs.existsSync(exportDir)) {
		nodeFs.mkdirSync(exportDir, { recursive: true });
	}
	const exportPath = nodePath.join(exportDir, fileName);

	// 同时附带会话沉淀下来的语义记忆，避免归档只剩流水账
	let factsSection = "";
	try {
		const factData = await recallFacts(ctx, _db, sessionId, 100, null);
		if (factData.facts && factData.facts.length > 0) {
			factsSection = [
				`## 📌 本会话沉淀的记忆`,
				``,
				...factData.facts.map((f) => `- [${f.kind}] ${f.content}`),
				``,
				`---`,
				``,
			].join("\n");
		}
	} catch {}

	const mdContent = [
		`# 会话归档: ${sessionId}`,
		``,
		`- 导出时间: ${new Date().toLocaleString('zh-CN')}`,
		`- 消息数量: ${messages.length}`,
		`- 描述: ${description}`,
		`- 对话时间范围: ${new Date(messages[0]?.timestamp).toLocaleString('zh-CN')} ~ ${new Date(messages[messages.length - 1]?.timestamp).toLocaleString('zh-CN')}`,
		``,
		`---`,
		``,
		factsSection,
	].join("\n");

	const messageContent = messages.map(msg => {
		const time = new Date(msg.timestamp).toLocaleString('zh-CN');
		const roleLabel = msg.role === "user" ? "👤 用户" : msg.role === "assistant" ? "🤖 助手" : `📝 ${msg.role}`;
		return `## ${time} | ${roleLabel}\n\n${msg.content}\n`;
	}).join("\n---\n\n");

	const fullContent = mdContent + messageContent;

	nodeFs.writeFileSync(exportPath, fullContent, "utf-8");

	// 记录快照
	await snapshotContext(ctx, _db, sessionId, `冻结导出: ${fileName}`);
	await writeAudit(_db, sessionId, "user", "freeze", "session", sessionId, fileName);

	return {
		ok: true,
		export_path: exportPath,
		file_name: fileName,
		messages_exported: messages.length,
		description,
	};
}

async function resetContext(ctx, sessionId) {
	// 重置前记录快照
	const beforeCount = _db ? _db.prepare("SELECT COUNT(*) as count FROM episodic WHERE session_id = ?").get(sessionId) : { count: 0 };
	await snapshotContext(ctx, _db, sessionId, "重置前快照");

	// 清空该会话的所有消息（不删除快照）
	if (_db) {
		_db.prepare("DELETE FROM episodic WHERE session_id = ?").run(sessionId);
	}

	return {
		ok: true,
		reset_messages: beforeCount.count,
		message: "已清空该会话的所有记忆，快照已保留"
	};
}

async function getContextStats(ctx, db, sessionId) {
	if (!db) return { ok: false, error: "数据库未初始化" };

	try {
		// L2 情景记忆统计
		const totalMsgs = db.prepare("SELECT COUNT(*) as count FROM episodic WHERE session_id = ?").get(sessionId);
		const totalTokens = db.prepare("SELECT SUM(token_count) as total FROM episodic WHERE session_id = ?").get(sessionId);
		const recentMsgs = db.prepare("SELECT COUNT(*) as count FROM episodic WHERE session_id = ? AND timestamp > ?").get(sessionId, Date.now() - 24 * 60 * 60 * 1000);
		const snapshotCount = db.prepare("SELECT COUNT(*) as count FROM snapshots WHERE session_id = ?").get(sessionId);
		const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const weekMsgs = db.prepare("SELECT COUNT(*) as count FROM episodic WHERE session_id = ? AND timestamp > ?").get(sessionId, weekAgo);

		// L3 语义记忆统计
		const totalFacts = db.prepare("SELECT COUNT(*) as count FROM semantic WHERE session_id = ?").get(sessionId);
		const activeFacts = db.prepare("SELECT COUNT(*) as count FROM semantic WHERE session_id = ? AND (expires_at IS NULL OR expires_at > ?)").get(sessionId, Date.now());
		const factsByKind = db.prepare(`
			SELECT kind, COUNT(*) as count FROM semantic
			WHERE session_id = ? GROUP BY kind
		`).all(sessionId);

		// L4 程序记忆 / 知识图谱统计
		const draftPending = db.prepare("SELECT COUNT(*) as count FROM skill_draft WHERE session_id = ? AND status = 'draft'").get(sessionId);
		const draftPublished = db.prepare("SELECT COUNT(*) as count FROM skill_draft WHERE session_id = ? AND status = 'published'").get(sessionId);
		const graphNodes = db.prepare("SELECT COUNT(*) as count FROM graph_node WHERE session_id = ?").get(sessionId);
		const graphEdges = db.prepare("SELECT COUNT(*) as count FROM graph_edge WHERE session_id = ?").get(sessionId);

		// 冲突记忆：同 kind 下内容高度重复（规范化后完全一致）的条数
		const conflictRows = db.prepare(`
			SELECT COUNT(*) as count FROM (
				SELECT lower(trim(content)) AS c, kind, COUNT(*) AS n
				FROM semantic WHERE session_id = ?
				GROUP BY c, kind HAVING n > 1
			)
		`).get(sessionId);

		const tokenTotal = totalTokens.total || 0;
		const budget = readConfigNumber(db, "context_budget", DEFAULT_CONTEXT_BUDGET);
		const usagePercent = Math.min(100, Math.round(((tokenTotal || 0) / budget) * 1000) / 10);

		return {
			ok: true,
			session_id: sessionId,
			// L2 情景记忆
			episodic: {
				total_messages: totalMsgs.count,
				total_tokens: tokenTotal,
				today_messages: recentMsgs.count,
				week_messages: weekMsgs.count,
				snapshot_count: snapshotCount.count,
			},
			// L3 语义记忆
			semantic: {
				total_facts: totalFacts.count,
				active_facts: activeFacts.count,
				by_kind: factsByKind,
				conflicts: conflictRows.count,
			},
			// L4 程序记忆
			procedural: {
				draft_pending: draftPending.count,
				draft_published: draftPublished.count,
			},
			// 知识图谱
			graph: {
				nodes: graphNodes.count,
				edges: graphEdges.count,
			},
			// 上下文占用率：接入 dsh-cost-meter 前，用累计记忆 token / 上下文预算估算
			context_budget: budget,
			usage_percent: usagePercent,
			usage_estimated: true,
			last_updated: new Date().toISOString(),
		};
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

function readConfigNumber(db, key, fallback) {
	try {
		const row = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(key);
		const n = row ? Number(row.value) : NaN;
		return Number.isFinite(n) && n > 0 ? n : fallback;
	} catch {
		return fallback;
	}
}

function writeConfig(db, key, value) {
	try {
		db.prepare("INSERT INTO memory_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
		return true;
	} catch {
		return false;
	}
}

// ============== P3: PluginUpdater 环境快照 ==============

const SNAPSHOTS_FILENAME = "environment_snapshots.json";

/**
 * 环境快照：保存当前插件/配置状态，用于 PluginUpdater 回滚和 Bundle 预装验证
 */
async function saveEnvironmentSnapshot(db, sessionId, cwd) {
	if (!db) return { ok: false, error: "database not initialized" };

	// 收集当前环境信息
	const pluginState = await collectPluginState(cwd);
	const configSnapshot = collectConfigSnapshot(db, sessionId);
	const memorySnapshot = collectMemorySnapshot(db, sessionId);

	const snapshot = {
		id: Date.now(),
		timestamp: new Date().toISOString(),
		session_id: sessionId,
		cwd: cwd || "",
		plugin_state: pluginState,
		config: configSnapshot,
		memory_stats: memorySnapshot,
		version: 1,
	};

	// 保存到 memory_config（key: snapshot:{id}）
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO memory_config (key, value)
		VALUES (?, ?)
	`);
	stmt.run(`snapshot:${sessionId}:${snapshot.id}`, JSON.stringify(snapshot));

	// 记录快照列表
	const listKey = `snapshots:${sessionId}`;
	const existingList = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(listKey);
	let snapshotList = existingList ? JSON.parse(existingList.value) : [];
	snapshotList.push({
		id: snapshot.id,
		timestamp: snapshot.timestamp,
		version: snapshot.version,
		memory_count: memorySnapshot.total_facts,
	});
	// 保留最近 50 个快照
	if (snapshotList.length > 50) snapshotList = snapshotList.slice(-50);
	stmt.run(listKey, JSON.stringify(snapshotList));

	return { ok: true, snapshot_id: snapshot.id, version: snapshot.version };
}

/**
 * 收集当前插件状态
 */
async function collectPluginState(cwd) {
	const state = {
		plugins: [],
		skills: [],
	};

	if (!cwd) return state;

	try {
		// 扫描 .workbuddy/skills 目录
		const skillsDir = nodePath.join(cwd, ".workbuddy", "skills");
		if (nodeFs.existsSync(skillsDir)) {
			const skills = nodeFs.readdirSync(skillsDir).filter(f => f.endsWith(".md"));
			state.skills = skills.map(s => ({ name: s.replace(".md", ""), path: nodePath.join(skillsDir, s) }));
		}

		// 扫描已加载的插件（从 ctx 获取，如果可用）
		// 实际插件列表由 DSH 核心管理，这里只做本地快照
	} catch (e) {
		state.error = e.message;
	}

	return state;
}

/**
 * 收集配置快照
 */
function collectConfigSnapshot(db, sessionId) {
	const configs = {};
	try {
		const rows = db.prepare("SELECT key, value FROM memory_config WHERE key LIKE ?").all(`config:${sessionId}:%`);
		for (const row of rows) {
			const key = row.key.replace(`config:${sessionId}:`, "");
			try {
				configs[key] = JSON.parse(row.value);
			} catch {
				configs[key] = row.value;
			}
		}
	} catch {}
	return configs;
}

/**
 * 收集记忆统计快照
 */
function collectMemorySnapshot(db, sessionId) {
	const stats = {
		episodic_count: 0,
		semantic_count: 0,
		graph_nodes: 0,
		skills_count: 0,
	};
	if (!db) return stats;
	try {
		const episodic = db.prepare("SELECT COUNT(*) as count FROM episodic WHERE session_id = ?").get(sessionId);
		const semantic = db.prepare("SELECT COUNT(*) as count FROM semantic WHERE session_id = ?").get(sessionId);
		const graph = db.prepare("SELECT COUNT(*) as count FROM graph_node WHERE session_id = ?").get(sessionId);
		const skills = db.prepare("SELECT COUNT(*) as count FROM skill_draft WHERE session_id = ?").get(sessionId);
		stats.episodic_count = episodic?.count || 0;
		stats.semantic_count = semantic?.count || 0;
		stats.graph_nodes = graph?.count || 0;
		stats.skills_count = skills?.count || 0;
		stats.total_facts = stats.semantic_count;
	} catch {}
	return stats;
}

/**
 * 列出环境快照
 */
function listEnvironmentSnapshots(db, sessionId) {
	if (!db) return { snapshots: [], total: 0 };
	try {
		const row = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(`snapshots:${sessionId}`);
		if (!row) return { snapshots: [], total: 0 };
		const list = JSON.parse(row.value);
		return { snapshots: list, total: list.length };
	} catch {
		return { snapshots: [], total: 0 };
	}
}

/**
 * 恢复环境快照
 */
function restoreEnvironmentSnapshot(db, sessionId, snapshotId) {
	if (!db) return { ok: false, error: "database not initialized" };
	try {
		const row = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(`snapshot:${sessionId}:${snapshotId}`);
		if (!row) return { ok: false, error: "snapshot not found" };

		const snapshot = JSON.parse(row.value);

		// 恢复配置
		if (snapshot.config && typeof snapshot.config === "object") {
			const stmt = db.prepare("INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)");
			for (const [key, value] of Object.entries(snapshot.config)) {
				const fullKey = `config:${sessionId}:${key}`;
				const jsonValue = typeof value === "string" ? value : JSON.stringify(value);
				stmt.run(fullKey, jsonValue);
			}
		}

		return { ok: true, restored_at: new Date().toISOString() };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

/**
 * 删除环境快照
 */
function deleteEnvironmentSnapshot(db, sessionId, snapshotId) {
	if (!db) return { ok: false, error: "database not initialized" };
	try {
		// 删除快照数据
		db.prepare("DELETE FROM memory_config WHERE key = ?").run(`snapshot:${sessionId}:${snapshotId}`);

		// 从列表中移除
		const listKey = `snapshots:${sessionId}`;
		const row = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(listKey);
		if (row) {
			let list = JSON.parse(row.value);
			list = list.filter(s => s.id !== snapshotId);
			db.prepare("UPDATE memory_config SET value = ? WHERE key = ?").run(JSON.stringify(list), listKey);
		}

		return { ok: true };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

// ============== Handler ==============

let _db = null;
let _dbPath = null;

const handler = async (req, res) => {
	if (!isTrustedRequest(req)) {
		sendJson(res, 403, { ok: false, error: "forbidden" });
		return;
	}
	if (req.method !== "POST") {
		sendJson(res, 405, { ok: false, error: "method-not-allowed" });
		return;
	}
	let body;
	try {
		body = await readJsonBody(req);
	} catch (e) {
		sendJson(res, 400, { ok: false, error: "bad-body: " + e.message });
		return;
	}

	try {
		const action = body && body.action;
		const sessionId = body.sessionId;
		const cwd = body.cwd;

		// 懒初始化数据库
		if (!_db || _dbPath !== cwd) {
			_dbPath = cwd;
			if (cwd && Sqlite) {
				_db = initDatabase(cwd + "/" + DB_FILENAME, Sqlite);
			}
		}

		// === 企业安全模式检查 ===
		const securityCheck = enforceSecurity(req, body, _db, sessionId, writeAudit);
		if (!securityCheck.ok) {
			return sendJson(res, 403, securityCheck);
		}

		// 安全模式下的特殊 action 处理
		if (action === "security_check" || action === "set_org_scope" ||
		    action === "get_org_scope" || action === "security_stats" ||
		    action === "toggle_enterprise_mode") {
			return sendJson(res, 200, handleSecurityAction(_db, sessionId, req, body, writeAudit));
		}

		if (action === "remember") {
			return sendJson(res, 200, await rememberMessage(ctx, _db, sessionId, body.role, body.content, body.tokenCount));
		}
		if (action === "recall") {
			return sendJson(res, 200, await recallMessages(ctx, _db, sessionId, body.limit));
		}
		if (action === "search") {
			return sendJson(res, 200, await searchMessages(ctx, _db, body.query, body.limit));
		}
		if (action === "snapshot") {
			return sendJson(res, 200, await snapshotContext(ctx, _db, sessionId, body.description));
		}
		if (action === "compress") {
			return sendJson(res, 200, await compressContext(ctx, sessionId, body.keepRecentRounds));
		}
		if (action === "trim") {
			return sendJson(res, 200, await trimContext(ctx, sessionId, body.keepRecentRounds));
		}
		if (action === "freeze") {
			return sendJson(res, 200, await freezeHistory(ctx, sessionId, body.description));
		}
		if (action === "reset") {
			return sendJson(res, 200, await resetContext(ctx, sessionId));
		}
		if (action === "stats") {
			return sendJson(res, 200, await getContextStats(ctx, _db, sessionId));
		}
		// L3 语义记忆操作
		if (action === "remember_fact") {
			const result = await rememberFact(ctx, _db, sessionId, body.content, body.kind, body.importance, body.tags);
			if (result && result.ok) {
				await writeAudit(_db, sessionId, body.actor || "agent", "remember_fact", "semantic", result.id, String(body.content || "").slice(0, 120));
				// 写入后清除该会话的召回和统计缓存
				nexusCache.del(recallCacheKey(sessionId, body.query, { limit: body.limit }));
				nexusCache.del(statsCacheKey(sessionId));
			}
			return sendJson(res, 200, result);
		}
		if (action === "recall_facts") {
			return sendJson(res, 200, await recallFacts(ctx, _db, sessionId, body.limit, body.kind));
		}
		if (action === "search_facts") {
			return sendJson(res, 200, await searchFacts(ctx, _db, sessionId, body.query, body.limit));
		}
		if (action === "forget_fact") {
			const result = await forgetFact(ctx, _db, body.factId);
			if (result && result.ok) {
				await writeAudit(_db, sessionId, body.actor || "user", "forget_fact", "semantic", body.factId, result.deleted_content);
				nexusCache.del(recallCacheKey(sessionId, null, {}));
				nexusCache.del(statsCacheKey(sessionId));
			}
			return sendJson(res, 200, result);
		}
		// Nexus-Prompt 编排层
		if (action === "build_prompt") {
			return sendJson(res, 200, await buildPrompt(ctx, _db, sessionId, body));
		}
		if (action === "recall_for_prompt") {
			return sendJson(res, 200, await recallForPrompt(ctx, _db, sessionId, body));
		}

		// ============ P2: L4 程序记忆（Skill 草稿） ============
		if (action === "skill_generate") {
			const result = L4.generateSkillDraft(_db, sessionId, {
				maxMessages: body.maxMessages,
				name: body.name,
				description: body.description,
				whenToUse: body.whenToUse,
				hint: body.hint,
			});
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "skill_generate", "skill_draft", result.draft_id, result.name);
			return sendJson(res, 200, result);
		}
		if (action === "skill_list") {
			return sendJson(res, 200, L4.listSkillDrafts(_db, sessionId, body.status || null, body.limit));
		}
		if (action === "skill_update") {
			const result = L4.updateSkillDraft(_db, body.draftId, body.patch || {});
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "skill_update", "skill_draft", body.draftId, JSON.stringify(body.patch || {}));
			return sendJson(res, 200, result);
		}
		if (action === "skill_review") {
			const result = L4.reviewSkillDraft(_db, body.draftId, body.decision, body.note);
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "skill_review", "skill_draft", body.draftId, result.status);
			return sendJson(res, 200, result);
		}
		if (action === "skill_publish") {
			const result = L4.publishSkillDraft(_db, body.draftId, body.scope || "project", cwd);
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "skill_publish", "skill_draft", body.draftId, result.path);
			return sendJson(res, 200, result);
		}
		if (action === "skill_import_md") {
			const result = L4.importSkillMd(_db, sessionId, body.content, {
				name: body.name,
				description: body.description,
				whenToUse: body.whenToUse,
				publishedPath: body.publishedPath,
			});
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "skill_import", "skill_draft", result.draft_id, result.name + " ← " + (result.metadata && result.metadata.fileName || "dsh-drop-md"));
			return sendJson(res, 200, result);
		}
		if (action === "skill_delete") {
			const result = L4.deleteSkillDraft(_db, body.draftId);
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "skill_delete", "skill_draft", body.draftId, result.name);
			return sendJson(res, 200, result);
		}

		// ============ P2: 知识图谱 ============
		if (action === "graph_upsert") {
			const id = Graph.upsertNode(_db, sessionId, body.title, body.content, body.nodeType);
			return sendJson(res, 200, { ok: !!id, node_id: id });
		}
		if (action === "graph_link") {
			return sendJson(res, 200, Graph.linkNodes(_db, sessionId, body.source, body.target, body.relation, body.weight));
		}
		if (action === "graph_parse") {
			const result = Graph.parseWikiLinks(_db, sessionId, body.text, body.title, body.nodeType);
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "agent", "graph_parse", "graph_node", result.source_node_id, body.title || "");
			return sendJson(res, 200, result);
		}
		if (action === "graph_view_global") {
			return sendJson(res, 200, Graph.viewGlobal(_db, sessionId, body.limit));
		}
		if (action === "graph_view_local") {
			return sendJson(res, 200, Graph.viewLocal(_db, sessionId, body.title, body.depth, body.limit));
		}
		if (action === "graph_search") {
			return sendJson(res, 200, Graph.searchNodes(_db, sessionId, body.query, body.limit));
		}
		if (action === "graph_recall") {
			return sendJson(res, 200, Graph.recallByGraph(_db, sessionId, body.query, body.limit));
		}
		if (action === "graph_stats") {
			return sendJson(res, 200, Graph.graphStats(_db, sessionId));
		}
		if (action === "graph_delete_node") {
			const result = Graph.deleteNode(_db, body.nodeId);
			if (result && result.ok) await writeAudit(_db, sessionId, body.actor || "user", "graph_delete_node", "graph_node", body.nodeId, result.title);
			return sendJson(res, 200, result);
		}

		// ============ P2: 记忆管理与可视化面板 ============
		if (action === "list_facts") {
			return sendJson(res, 200, Admin.listFacts(_db, sessionId, body));
		}
		if (action === "update_fact") {
			const result = Admin.updateFact(_db, body.factId, body.patch || {}, body.actor);
			if (result && result.ok) {
				await writeAudit(_db, sessionId, body.actor || "user", "update_fact", "semantic", body.factId, JSON.stringify(body.patch || {}));
				nexusCache.del(recallCacheKey(sessionId, null, {}));
				nexusCache.del(statsCacheKey(sessionId));
			}
			return sendJson(res, 200, result);
		}
		if (action === "pin_fact") {
			const result = Admin.pinFact(_db, body.factId, body.pinned !== false);
			if (result && result.ok) {
				await writeAudit(_db, sessionId, body.actor || "user", "pin_fact", "semantic", body.factId, String(result.pinned));
				nexusCache.del(recallCacheKey(sessionId, null, {}));
				nexusCache.del(statsCacheKey(sessionId));
			}
			return sendJson(res, 200, result);
		}
		if (action === "batch_forget") {
			const result = Admin.batchForget(_db, body.ids);
			if (result && result.ok) {
				await writeAudit(_db, sessionId, body.actor || "user", "batch_forget", "semantic", null, "删除 " + result.deleted + " 条");
				nexusCache.del(recallCacheKey(sessionId, null, {}));
				nexusCache.del(statsCacheKey(sessionId));
			}
			return sendJson(res, 200, result);
		}
		if (action === "conflicts") {
			return sendJson(res, 200, Admin.findConflicts(_db, sessionId));
		}
		if (action === "dashboard") {
			return sendJson(res, 200, Admin.getDashboard(_db, sessionId, _db ? _dbPath + "/" + DB_FILENAME : null));
		}
		if (action === "audit_log") {
			return sendJson(res, 200, await getAuditLog(ctx, _db, sessionId, body.limit, body.actor));
		}
		if (action === "set_config") {
			const ok = writeConfig(_db, body.key, body.value);
			return sendJson(res, 200, { ok, key: body.key, value: body.value });
		}
		// ============ Token 优化：缓存管理 ============
		if (action === "clear_cache") {
			// 清除指定前缀或全部缓存（写入操作后调用，保证数据新鲜度）
			const prefix = body.prefix;
			if (prefix) {
				const keys = Array.from(nexusCache._store.keys());
				for (const k of keys) {
					if (k.startsWith(prefix)) nexusCache._store.delete(k);
				}
			} else {
				nexusCache.clear();
			}
			return sendJson(res, 200, { ok: true, message: "缓存已清除" });
		}
		if (action === "cache_stats") {
			return sendJson(res, 200, {
				ok: true,
				recall_cache: nexusCache.stats(),
				token_estimate: tokenEstimateCache.stats(),
			});
		}

		// ============ 跨插件记忆迁移 ============
		if (action === "detect_plugins") {
			return sendJson(res, 200, {
				ok: true,
				plugins: detectMemoryPlugins(),
			});
		}
		if (action === "migrate") {
			const result = migrateFromOtherPlugins(_db, sessionId, body.options || {});
			if (result.ok && result.imported > 0) {
				// 迁移后清除缓存，保证数据新鲜度
				nexusCache.del(recallCacheKey(sessionId, null, {}));
				nexusCache.del(statsCacheKey(sessionId));
				await writeAudit(_db, sessionId, body.actor || "system", "migrate", "semantic", null, `导入 ${result.imported} 条记忆`);
			}
			return sendJson(res, 200, result);
		}

		// ============ P3: 备份与迁移 ============
		if (action === "export") {
			const result = await handleExport(_db, sessionId, body.format || "json", body.options || {});
			if (result.ok) await writeAudit(_db, sessionId, body.actor || "user", "export", "semantic", sessionId, result.fileName);
			return sendJson(res, 200, result);
		}
		if (action === "import") {
			const result = await handleImport(_db, sessionId, body.filePath, body.options || {});
			if (result.ok && (result.imported?.semantic > 0 || result.imported?.nodes > 0)) {
				nexusCache.del(recallCacheKey(sessionId, null, {}));
				nexusCache.del(statsCacheKey(sessionId));
				await writeAudit(_db, sessionId, body.actor || "user", "import", "semantic", sessionId, `导入 ${result.imported.semantic} 条记忆`);
			}
			return sendJson(res, 200, result);
		}
		if (action === "validate_package") {
			try {
				const pkg = JSON.parse(body.content || "{}");
				const result = validateMigrationPackage(pkg);
				return sendJson(res, 200, result);
			} catch (e) {
				return sendJson(res, 200, { ok: false, error: "JSON 解析失败: " + e.message });
			}
		}

		// ============ 跨插件联动：dsh-drop-md 拖入的文档 ============
		if (action === "ingest_document") {
			return sendJson(res, 200, await ingestDocument(ctx, _db, sessionId, body));
		}

		// ============ P3: PluginUpdater 环境快照 ============
		if (action === "save_environment_snapshot") {
			const result = await saveEnvironmentSnapshot(_db, sessionId, cwd);
			if (result.ok) await writeAudit(_db, sessionId, body.actor || "system", "save_environment_snapshot", "config", null, `快照 v${result.version}`);
			return sendJson(res, 200, result);
		}
		if (action === "list_snapshots") {
			return sendJson(res, 200, listEnvironmentSnapshots(_db, sessionId));
		}
		if (action === "restore_snapshot") {
			const result = restoreEnvironmentSnapshot(_db, sessionId, body.snapshotId);
			if (result.ok) await writeAudit(_db, sessionId, body.actor || "user", "restore_snapshot", "config", body.snapshotId, "");
			return sendJson(res, 200, result);
		}
		if (action === "delete_snapshot") {
			const result = deleteEnvironmentSnapshot(_db, sessionId, body.snapshotId);
			if (result.ok) await writeAudit(_db, sessionId, body.actor || "user", "delete_snapshot", "config", body.snapshotId, "");
			return sendJson(res, 200, result);
		}
		sendJson(res, 400, { ok: false, error: "unknown-action" });
	} catch (e) {
		sendJson(res, 200, { ok: false, error: e.message });
	}
};

// ============== Nexus-Prompt 编排层 ==============

async function recallForPrompt(ctx, db, sessionId, options = {}) {
	if (!db) return { memories: [], total: 0, error: "数据库未初始化" };

	// === Token 优化：缓存命中直接返回 ===
	const cacheKey = recallCacheKey(sessionId, options.query, options);
	const cached = nexusCache.get(cacheKey);
	if (cached) {
		return { ...cached.data, cached: true, cache_remaining_ms: cached.remainingMs };
	}

	const memoryMaxToken = options.memory_max_token || 3000;
	const query = options.query || "";
	const limit = options.limit || 10;

	// 从 L3 语义记忆中召回
	const semanticResults = await recallFacts(ctx, db, sessionId, limit, null);

	// 从 L2 情景记忆中召回（按关键词搜索）
	let episodicResults = { messages: [] };
	if (query) {
		episodicResults = await searchMessages(ctx, db, query, limit);
	} else {
		// 最近对话作为背景
		episodicResults = await recallMessages(ctx, db, sessionId, Math.min(limit, 5));
	}

	// 组装记忆片段，控制总 token
	const memories = [];
	let usedTokens = 0;

	// 优先添加语义记忆（重要性高）
	for (const fact of semanticResults.facts || []) {
		// 使用 token 估算缓存，避免重复计算相同内容的 token
		let tokens = tokenEstimateCache.get(fact.content);
		if (tokens === null) {
			tokens = estimateTokens(fact.content);
			tokenEstimateCache.set(fact.content, tokens);
		}
		if (usedTokens + tokens > memoryMaxToken) break;
		memories.push({
			type: "semantic",
			content: fact.content,
			kind: fact.kind,
			importance: fact.importance,
			tokens: tokens,
		});
		usedTokens += tokens;
	}

	// 补充情景记忆
	for (const msg of episodicResults.messages || []) {
		let tokens = tokenEstimateCache.get(msg.content);
		if (tokens === null) {
			tokens = estimateTokens(msg.content);
			tokenEstimateCache.set(msg.content, tokens);
		}
		if (usedTokens + tokens > memoryMaxToken) break;
		memories.push({
			type: "episodic",
			content: msg.content,
			role: msg.role,
			tokens: tokens,
		});
		usedTokens += tokens;
	}

	// 补充 L4 程序记忆：已发布/已通过审核的可用技能
	let skillCount = 0;
	if (options.include_skills !== false) {
		try {
			const drafts = L4.listSkillDrafts(db, sessionId, null, 20);
			for (const d of drafts.drafts || []) {
				if (d.status !== "published" && d.status !== "approved") continue;
				const text = "[技能:" + d.name + "] " + d.description;
				const tokens = estimateTokens(text);
				if (usedTokens + tokens > memoryMaxToken) break;
				memories.push({
					type: "procedural",
					content: text,
					skill_id: d.id,
					status: d.status,
					tokens: tokens,
				});
				usedTokens += tokens;
				skillCount += 1;
			}
		} catch {}
	}

	// 补充知识图谱：命中节点 + 一跳邻居（仅在有查询词时）
	let graphCount = 0;
	if (query && options.include_graph !== false) {
		try {
			const graphData = Graph.recallByGraph(db, sessionId, query, options.graph_limit || 5);
			for (const n of graphData.nodes || []) {
				const text = "[图谱:" + n.title + "]" + (n.excerpt ? " " + n.excerpt : "");
				let tokens = tokenEstimateCache.get(text);
				if (tokens === null) {
					tokens = estimateTokens(text);
					tokenEstimateCache.set(text, tokens);
				}
				if (usedTokens + tokens > memoryMaxToken) break;
				memories.push({
					type: "graph",
					content: text,
					node_id: n.id,
					is_center: !!n.is_center,
					tokens: tokens,
				});
				usedTokens += tokens;
				graphCount += 1;
			}
		} catch {}
	}

	const result = {
		ok: true,
		memories,
		total: memories.length,
		total_tokens: usedTokens,
		memory_max_token: memoryMaxToken,
		by_type: {
			semantic: memories.filter((m) => m.type === "semantic").length,
			episodic: memories.filter((m) => m.type === "episodic").length,
			procedural: skillCount,
			graph: graphCount,
		},
		omitted: semanticResults.total + episodicResults.total + skillCount + graphCount - memories.length,
	};

	// === 缓存召回结果 ===
	nexusCache.set(cacheKey, result, CACHE_TTL_MS);
	return result;
}

async function buildPrompt(ctx, db, sessionId, options = {}) {
	if (!db) return { ok: false, error: "数据库未初始化" };

	const memoryMaxToken = options.memory_max_token || 3000;
	const memoryPriority = options.memory_priority !== false;
	const enableStructuredPrompt = options.enable_structured_prompt !== false;
	const omitMemoryTip = options.omit_memory_tip !== false;

	// 召回记忆
	const recallResult = await recallForPrompt(ctx, db, sessionId, {
		memory_max_token: memoryMaxToken,
		query: options.query,
		limit: options.recall_limit || 20,
	});

	if (!recallResult.ok) {
		return recallResult;
	}

	// 构建结构化 prompt
	const memoriesText = recallResult.memories.map(m => {
		if (m.type === "semantic") return `[记忆:${m.kind}] ${m.content}`;
		if (m.type === "procedural") return `[技能] ${m.content}`;
		if (m.type === "graph") return `[图谱] ${m.content}`;
		return `[对话:${m.role}] ${m.content}`;
	}).join("\n");

	const omitTip = recallResult.omitted > 0 && omitMemoryTip
		? "\n> 提示：部分记忆已省略，可调用 memory_search 工具查询更多。"
		: "";

	if (enableStructuredPrompt) {
		return {
			ok: true,
			prompt: [
				"=== 系统提示词 ===",
				options.system_prompt || "[系统提示词]",
				"",
				"=== 召回记忆（来自记忆系统） ===",
				memoriesText || "[暂无相关记忆]",
				omitTip,
				"",
				"=== 当前会话对话 ===",
				options.conversation || "[当前对话]",
				"",
				"=== MCP & 插件工具定义 ===",
				options.tools || "[工具定义]",
			].join("\n"),
			memory_tokens: recallResult.total_tokens,
			memory_count: recallResult.total,
			omitted: recallResult.omitted,
		};
	}

	return {
		ok: true,
		memories: recallResult.memories,
		total_tokens: recallResult.total_tokens,
		omitted: recallResult.omitted,
	};
}

export { saveEnvironmentSnapshot, listEnvironmentSnapshots, restoreEnvironmentSnapshot, deleteEnvironmentSnapshot };

// ============== Plugin Export ==============

let registered = false;
const tryRegister = (value) => {
	if (registered) return;
	const webServer = value ?? (ctx.reflect && typeof ctx.reflect.get === "function"
		? ctx.reflect.get("webServer", false)
		: ctx.get("webServer"));
	if (webServer === undefined) return;
	ctx.effect(
		() => webServer.register({ kind: "prefix", path: ROUTE_PATH, handler }),
		"memory-nexus: api route",
	);
	registered = true;
};
tryRegister(undefined);
ctx.on("internal/service", (name, value) => {
	if (name === "webServer") tryRegister(value);
});
