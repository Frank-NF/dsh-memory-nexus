// dsh-memory-nexus — 审计日志
//
// 记录每一条记忆的写入 / 修改 / 删除，区分 Agent 与 User 操作者，
// 供记忆面板的「审计日志」页与问题追溯使用。

export async function writeAudit(db, sessionId, actor, action, targetType, targetId, detail) {
	if (!db) return;
	try {
		db.prepare(`
			INSERT INTO audit_log (session_id, actor, action, target_type, target_id, detail, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).run(
			sessionId || null,
			actor || "agent",
			action,
			targetType || null,
			targetId === undefined || targetId === null ? null : String(targetId),
			detail ? (typeof detail === "string" ? detail : JSON.stringify(detail)) : null,
			Date.now(),
		);
	} catch {}
}

export async function getAuditLog(ctx, db, sessionId, limit = 50, actor = null) {
	if (!db) return { logs: [], total: 0, error: "database not initialized" };
	let sql = "SELECT id, session_id, actor, action, target_type, target_id, detail, created_at FROM audit_log";
	const params = [];
	const where = [];
	if (sessionId) { where.push("session_id = ?"); params.push(sessionId); }
	if (actor) { where.push("actor = ?"); params.push(actor); }
	if (where.length > 0) sql += " WHERE " + where.join(" AND ");
	sql += " ORDER BY created_at DESC LIMIT ?";
	params.push(limit);
	const rows = db.prepare(sql).all(...params);
	return {
		logs: rows.map((r) => ({
			id: r.id,
			session_id: r.session_id,
			actor: r.actor,
			action: r.action,
			target_type: r.target_type,
			target_id: r.target_id,
			detail: r.detail,
			created_at: r.created_at,
		})),
		total: rows.length,
	};
}
