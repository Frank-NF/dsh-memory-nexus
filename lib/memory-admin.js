// dsh-memory-nexus — 记忆管理 + 仪表盘（P2）
//
// 语义记忆的编辑 / 置顶 / 批量遗忘，以及四层记忆统一仪表盘。

import nodeFs from "node:fs";
import { calculateTTLSeconds, MEMORY_KINDS } from "./ttl.js";

const EDITABLE = ["content", "kind", "importance", "tags"];
const KINDS = MEMORY_KINDS;

function snapshotVersion(db, fact, changeType) {
	try {
		db.prepare(
			`INSERT INTO semantic_version (semantic_id, version, content, change_type, changed_at)
			 VALUES (?, ?, ?, ?, ?)`,
		).run(fact.id, fact.version || 1, fact.content, changeType || "update", Date.now());
	} catch {}
}

export function listFacts(db, sessionId, options = {}) {
	if (!db) return { facts: [], total: 0, error: "database not initialized" };
	const limit = Math.min(options.limit || 100, 500);
	const offset = options.offset || 0;

	let sql = `SELECT id, session_id, content, kind, importance, tags, created_at, updated_at, expires_at,
	                  COALESCE(pinned, 0) AS pinned, COALESCE(source, 'agent') AS source, version
	           FROM semantic WHERE 1 = 1`;
	const params = [];
	if (sessionId) { sql += " AND session_id = ?"; params.push(sessionId); }
	if (options.kind) { sql += " AND kind = ?"; params.push(options.kind); }
	if (options.pinned !== undefined && options.pinned !== null) {
		sql += " AND COALESCE(pinned, 0) = ?";
		params.push(options.pinned ? 1 : 0);
	}
	if (options.includeExpired !== true) {
		sql += " AND (expires_at IS NULL OR expires_at > ?)";
		params.push(Date.now());
	}
	if (options.query) {
		sql += " AND content LIKE ?";
		params.push("%" + String(options.query).replace(/[%_]/g, (m) => "\\" + m) + "%");
	}
	sql += " ORDER BY COALESCE(pinned, 0) DESC, importance DESC, updated_at DESC LIMIT ? OFFSET ?";
	params.push(limit, offset);

	const rows = db.prepare(sql).all(...params);
	return {
		facts: rows.map((r) => ({
			id: r.id,
			session_id: r.session_id,
			content: r.content,
			kind: r.kind,
			importance: r.importance,
			tags: safeJson(r.tags, []),
			created_at: r.created_at,
			updated_at: r.updated_at,
			expires_at: r.expires_at,
			pinned: !!r.pinned,
			source: r.source,
			version: r.version,
		})),
		total: rows.length,
		offset,
		limit,
	};
}

function safeJson(text, fallback) {
	try {
		const v = JSON.parse(text || "[]");
		return Array.isArray(v) ? v : fallback;
	} catch {
		return fallback;
	}
}

export function updateFact(db, factId, patch = {}, actor = "user") {
	if (!db) return { ok: false, error: "database not initialized" };
	const fact = db.prepare("SELECT * FROM semantic WHERE id = ?").get(factId);
	if (!fact) return { ok: false, error: "记忆不存在" };

	// 内容变更时先落版本，保留可追溯链
	if (patch.content !== undefined && String(patch.content).trim() !== String(fact.content)) {
		snapshotVersion(db, fact, "update");
	}

	const sets = [];
	const params = [];
	for (const key of EDITABLE) {
		if (patch[key] === undefined) continue;
		let value = patch[key];
		if (key === "content") value = String(value).trim();
		if (key === "kind") value = KINDS.includes(value) ? value : fact.kind;
		if (key === "importance") value = Math.max(0, Math.min(1, Number(value) || 0));
		if (key === "tags") value = JSON.stringify(Array.isArray(value) ? value : []);
		sets.push(key + " = ?");
		params.push(value);
	}
	// 改了 kind 就按新类型重算过期时间
	if (patch.kind !== undefined && KINDS.includes(patch.kind)) {
		const ttl = calculateTTLSeconds(patch.kind, Date.now());
		sets.push("expires_at = ?");
		params.push(ttl);
	}
	if (patch.pinned !== undefined) {
		sets.push("pinned = ?");
		params.push(patch.pinned ? 1 : 0);
	}
	if (sets.length === 0) return { ok: true, unchanged: true };

	if (patch.content !== undefined) {
		sets.push("version = COALESCE(version, 1) + 1");
	}
	sets.push("updated_at = ?");
	params.push(Date.now());
	params.push(factId);

	db.prepare("UPDATE semantic SET " + sets.join(", ") + " WHERE id = ?").run(...params);

	return { ok: true, id: factId, updated: true, actor };
}

export function pinFact(db, factId, pinned = true) {
	if (!db) return { ok: false, error: "database not initialized" };
	const fact = db.prepare("SELECT id FROM semantic WHERE id = ?").get(factId);
	if (!fact) return { ok: false, error: "记忆不存在" };
	db.prepare("UPDATE semantic SET pinned = ?, updated_at = ? WHERE id = ?").run(pinned ? 1 : 0, Date.now(), factId);
	return { ok: true, id: factId, pinned: !!pinned };
}

export function batchForget(db, ids) {
	if (!db) return { ok: false, error: "database not initialized" };
	const list = Array.isArray(ids) ? ids.filter((x) => Number.isFinite(Number(x))) : [];
	if (list.length === 0) return { ok: false, error: "没有要删除的记忆" };

	// 临时关闭 FK 检查（审计日志的 delete 版本需要在删除 semantic 后仍保留引用语义）
	const hadFk = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
	db.exec("PRAGMA foreign_keys = OFF");

	let deleted = 0;
	for (const id of list) {
		const fact = db.prepare("SELECT id, content, version FROM semantic WHERE id = ?").get(Number(id));
		if (!fact) continue;
		snapshotVersion(db, fact, "delete");
		db.prepare("DELETE FROM semantic WHERE id = ?").run(Number(id));
		deleted += 1;
	}

	if (!hadFk) db.exec("PRAGMA foreign_keys = OFF");
	else db.exec("PRAGMA foreign_keys = ON");

	return { ok: true, requested: list.length, deleted };
}

// 找出内容重复（规范化后一致）的记忆组，供面板提示合并
export function findConflicts(db, sessionId) {
	if (!db) return { conflicts: [], total: 0 };
	const rows = db
		.prepare(
			`SELECT lower(trim(content)) AS c, kind, COUNT(*) AS n
			 FROM semantic WHERE session_id = ?
			 GROUP BY c, kind HAVING n > 1 ORDER BY n DESC LIMIT 20`,
		)
		.all(sessionId);

	const groups = [];
	for (const r of rows) {
		const items = db
			.prepare(
				`SELECT id, content, kind, importance, updated_at, COALESCE(pinned,0) AS pinned
				 FROM semantic WHERE session_id = ? AND kind = ? AND lower(trim(content)) = ?
				 ORDER BY COALESCE(pinned,0) DESC, updated_at DESC`,
			)
			.all(sessionId, r.kind, r.c);
		groups.push({ kind: r.kind, count: r.n, items });
	}
	return { conflicts: groups, total: groups.length };
}

export function getDashboard(db, sessionId, dbPath) {
	if (!db) return { ok: false, error: "database not initialized" };

	const now = Date.now();
	const q = (sql, ...params) => db.prepare(sql).get(...params);

	// L1 运行记忆：进程内，未持久化，这里给出说明性指标
	const l1 = { persisted: false, note: "进程内运行态，未落库" };

	// L2 情景记忆
	const l2 = {
		messages: q("SELECT COUNT(*) AS c FROM episodic WHERE session_id = ?", sessionId).c,
		tokens: q("SELECT COALESCE(SUM(token_count),0) AS c FROM episodic WHERE session_id = ?", sessionId).c,
		snapshots: q("SELECT COUNT(*) AS c FROM snapshots WHERE session_id = ?", sessionId).c,
		today: q("SELECT COUNT(*) AS c FROM episodic WHERE session_id = ? AND timestamp > ?", sessionId, now - 86400000).c,
	};

	// L3 语义记忆
	const l3 = {
		facts: q("SELECT COUNT(*) AS c FROM semantic WHERE session_id = ?", sessionId).c,
		active: q("SELECT COUNT(*) AS c FROM semantic WHERE session_id = ? AND (expires_at IS NULL OR expires_at > ?)", sessionId, now).c,
		expired: q("SELECT COUNT(*) AS c FROM semantic WHERE session_id = ? AND expires_at IS NOT NULL AND expires_at <= ?", sessionId, now).c,
		pinned: q("SELECT COUNT(*) AS c FROM semantic WHERE session_id = ? AND COALESCE(pinned,0) = 1", sessionId).c,
		versions: q("SELECT COUNT(*) AS c FROM semantic_version").c,
	};

	// L4 程序记忆
	const l4 = {
		drafts: q("SELECT COUNT(*) AS c FROM skill_draft WHERE session_id = ? AND status = 'draft'", sessionId).c,
		approved: q("SELECT COUNT(*) AS c FROM skill_draft WHERE session_id = ? AND status = 'approved'", sessionId).c,
		published: q("SELECT COUNT(*) AS c FROM skill_draft WHERE session_id = ? AND status = 'published'", sessionId).c,
		rejected: q("SELECT COUNT(*) AS c FROM skill_draft WHERE session_id = ? AND status = 'rejected'", sessionId).c,
	};

	// 知识图谱
	const graph = {
		nodes: q("SELECT COUNT(*) AS c FROM graph_node WHERE session_id = ?", sessionId).c,
		edges: q("SELECT COUNT(*) AS c FROM graph_edge WHERE session_id = ?", sessionId).c,
	};

	// 数据库体积
	let dbSize = 0;
	try {
		if (dbPath && nodeFs.existsSync(dbPath)) dbSize = nodeFs.statSync(dbPath).size;
	} catch {}

	const conflicts = findConflicts(db, sessionId);

	return {
		ok: true,
		session_id: sessionId,
		layers: { l1, l2, l3, l4, graph },
		db_size_bytes: dbSize,
		conflicts: conflicts.total,
		generated_at: new Date().toISOString(),
	};
}
