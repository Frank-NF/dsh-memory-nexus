// dsh-memory-nexus — L4 程序记忆（Skill 草稿）
//
// 从会话沉淀中生成可复用的 Skill 草稿（SKILL.md），支持审核 / 驳回 / 发布到
// 官方技能扫描根（项目 .dsh/skills 或用户 ~/.dsh/skills）。
//
// 所有函数均为同步（better-sqlite3 同步 API），由 lib/index.js 的路由层包装。

import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeOs from "node:os";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 生成 Skill 目录名：中文/空格等一律降级为连字符，保证符合官方命名校验
export function slugify(input, fallback = "session-skill") {
	const base = String(input || "")
		.toLowerCase()
		.trim()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9一-龥-]/g, "");
	let ascii = base.replace(/[一-龥]+/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
	if (!ascii) ascii = fallback;
	if (!NAME_RE.test(ascii)) ascii = fallback;
	return ascii.slice(0, 48);
}

const STOPWORDS = new Set([
	"的", "了", "是", "在", "我", "你", "他", "它", "这", "那", "有", "和", "就", "都", "而", "及", "与",
	"也", "很", "到", "说", "要", "会", "能", "对", "把", "被", "让", "给", "吗", "呢", "吧", "啊",
	"一个", "我们", "你们", "他们", "可以", "什么", "怎么", "如何", "为什么", "这个", "那个", "现在",
	"the", "a", "an", "is", "are", "was", "were", "to", "of", "and", "or", "for", "in", "on", "at",
	"it", "this", "that", "you", "we", "they", "do", "does", "did", "can", "could", "would", "should",
]);

// 从文本中抽取关键词（中文按 2~4 字滑窗，英文按词），用于生成描述与标签
export function extractKeywords(text, limit = 8) {
	if (!text) return [];
	const cleaned = String(text).replace(/[`*_#>\[\]()（）【】"'`，。！？、；：\n\r\t]/g, " ");
	const scores = new Map();
	const bump = (word) => {
		if (!word || word.length < 2) return;
		if (STOPWORDS.has(word)) return;
		if (/^\d+$/.test(word)) return;
		scores.set(word, (scores.get(word) || 0) + 1);
	};
	// 英文词
	for (const w of cleaned.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) || []) bump(w.toLowerCase());
	// 中文 N-gram（2~4 字）
	for (const run of cleaned.split(/[^一-龥]+/)) {
		const s = run.trim();
		if (!s) continue;
		for (let n = 2; n <= 4; n += 1) {
			for (let i = 0; i + n <= s.length; i += 1) bump(s.slice(i, i + n));
		}
	}
	// 长词优先（4 字词得分低于 2 字词会淹没，这里按 长度*频次 排序）
	return Array.from(scores.entries())
		.map(([word, count]) => ({ word, score: count * (1 + Math.min(word.length, 4) * 0.35) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit * 3)
		.filter((a, i, arr) => !arr.slice(0, i).some((b) => b.word.includes(a.word) || a.word.includes(b.word)))
		.slice(0, limit)
		.map((x) => x.word);
}

// 组装标准 SKILL.md 文本
export function buildSkillMarkdown({ name, description, whenToUse, steps, constraints, source }) {
	const lines = [
		"---",
		"name: " + name,
		"description: " + description,
	];
	if (whenToUse) lines.push("whenToUse: " + whenToUse);
	lines.push("---", "", "# " + name, "", "## 适用场景", "", whenToUse || description, "");

	if (steps && steps.length > 0) {
		lines.push("## 操作步骤", "");
		steps.forEach((s, i) => lines.push((i + 1) + ". " + s));
		lines.push("");
	}

	if (constraints && constraints.length > 0) {
		lines.push("## 关键约束与偏好", "");
		constraints.forEach((c) => lines.push("- " + c));
		lines.push("");
	}

	if (source) {
		lines.push("## 来源", "", source, "");
	}

	return lines.join("\n");
}

// 从会话记录 + 语义记忆生成一份 Skill 草稿
export function generateSkillDraft(db, sessionId, options = {}) {
	if (!db) return { ok: false, error: "database not initialized" };

	const maxMessages = options.maxMessages || 60;
	const nameRaw = options.name || "";
	const hint = options.hint || "";

	// 1) 取最近消息（正序）
	const rows = db
		.prepare(
			`SELECT id, role, content, timestamp FROM episodic
			 WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
		)
		.all(sessionId, maxMessages)
		.reverse();

	if (rows.length === 0) {
		return { ok: false, error: "当前会话没有可沉淀的记录" };
	}

	// 2) 取语义记忆作为关键约束
	const facts = db
		.prepare(
			`SELECT content, kind, importance FROM semantic
			 WHERE session_id = ? AND (expires_at IS NULL OR expires_at > ?)
			 ORDER BY importance DESC, updated_at DESC LIMIT 20`,
		)
		.all(sessionId, Date.now());

	// 3) 用户诉求（user 消息）作为步骤骨架
	const userAsks = rows.filter((r) => r.role === "user").map((r) => String(r.content).trim());
	const topic = (hint || userAsks[0] || rows[0].content || "").replace(/\s+/g, " ").slice(0, 60);

	const keywords = extractKeywords(
		userAsks.slice(0, 12).join("\n") + "\n" + facts.map((f) => f.content).join("\n"),
		6,
	);

	// 步骤：去重的用户诉求，单条截断 140 字
	const seen = new Set();
	const steps = [];
	for (const ask of userAsks) {
		if (steps.length >= 8) break;
		const one = ask.replace(/\s+/g, " ").slice(0, 140);
		if (one.length < 4) continue;
		const key = one.slice(0, 24);
		if (seen.has(key)) continue;
		seen.add(key);
		steps.push(one);
	}
	if (steps.length === 0) {
		steps.push("（会话中没有明确的操作步骤，请人工补充）");
	}

	const constraints = facts.slice(0, 10).map((f) => "[" + f.kind + "] " + String(f.content).replace(/\s+/g, " ").slice(0, 120));
	const description = (options.description || ("围绕「" + topic + "」沉淀的会话流程")).replace(/\s+/g, " ").slice(0, 160);
	const whenToUse = options.whenToUse || ("当用户需要 " + (keywords.slice(0, 3).join(" / ") || topic) + " 时使用");

	// 4) 名称：优先用户给定，其次主题 slug，最后按会话 + 序号兜底
	let name = slugify(nameRaw || topic, "session-skill");
	if (!nameRaw) {
		const existing = db.prepare("SELECT COUNT(*) as c FROM skill_draft WHERE session_id = ?").get(sessionId);
		const suffix = existing.c > 0 ? "-" + (existing.c + 1) : "";
		name = slugify(topic, "session-skill") + suffix;
	}

	const content = buildSkillMarkdown({
		name,
		description,
		whenToUse,
		steps,
		constraints,
		source:
			"由 dsh-memory-nexus 从会话 " +
			sessionId +
			" 自动生成（" +
			rows.length +
			" 条消息 / " +
			facts.length +
			" 条记忆），生成时间 " +
			new Date().toLocaleString("zh-CN") +
			"。",
	});

	const now = Date.now();
	const info = db
		.prepare(
			`INSERT INTO skill_draft
			 (session_id, name, description, when_to_use, content, source, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'generated', 'draft', ?, ?)`,
		)
		.run(sessionId, name, description, whenToUse, content, now, now);

	return {
		ok: true,
		draft_id: info.lastInsertRowid,
		name,
		description,
		when_to_use: whenToUse,
		content,
		keywords,
		based_on: { messages: rows.length, facts: facts.length },
	};
}

export function listSkillDrafts(db, sessionId, status = null, limit = 50) {
	if (!db) return { drafts: [], total: 0, error: "database not initialized" };
	let sql = `SELECT id, session_id, name, description, when_to_use, source, status,
	                  review_note, published_path, created_at, updated_at, reviewed_at
	           FROM skill_draft`;
	const params = [];
	const where = [];
	if (sessionId) { where.push("session_id = ?"); params.push(sessionId); }
	if (status) { where.push("status = ?"); params.push(status); }
	if (where.length > 0) sql += " WHERE " + where.join(" AND ");
	sql += " ORDER BY updated_at DESC LIMIT ?";
	params.push(limit);
	const rows = db.prepare(sql).all(...params);
	return { drafts: rows, total: rows.length };
}

export function getSkillDraft(db, id) {
	if (!db) return null;
	return db.prepare("SELECT * FROM skill_draft WHERE id = ?").get(id) || null;
}

export function updateSkillDraft(db, id, patch = {}) {
	if (!db) return { ok: false, error: "database not initialized" };
	const draft = getSkillDraft(db, id);
	if (!draft) return { ok: false, error: "草稿不存在" };

	const fields = {};
	for (const key of ["name", "description", "when_to_use", "content", "review_note"]) {
		if (patch[key] !== undefined) fields[key] = patch[key];
	}
	if (fields.name !== undefined) fields.name = slugify(fields.name, draft.name);
	if (Object.keys(fields).length === 0) return { ok: true, unchanged: true };

	fields.updated_at = Date.now();
	const sets = Object.keys(fields).map((k) => k + " = ?").join(", ");
	db.prepare("UPDATE skill_draft SET " + sets + " WHERE id = ?").run(...Object.values(fields), id);
	return { ok: true, draft_id: id, updated: Object.keys(fields) };
}

export function reviewSkillDraft(db, id, decision, note = "") {
	if (!db) return { ok: false, error: "database not initialized" };
	const draft = getSkillDraft(db, id);
	if (!draft) return { ok: false, error: "草稿不存在" };

	const status = decision === "reject" ? "rejected" : "approved";
	const now = Date.now();
	db.prepare(
		"UPDATE skill_draft SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
	).run(status, note, now, now, id);

	return { ok: true, draft_id: id, status, review_note: note };
}

// 发布到官方技能扫描根，写入后由技能目录 watcher 自动发现
export function publishSkillDraft(db, id, scope = "project", cwd = "") {
	if (!db) return { ok: false, error: "database not initialized" };
	const draft = getSkillDraft(db, id);
	if (!draft) return { ok: false, error: "草稿不存在" };

	const name = slugify(draft.name, "session-skill");
	if (!NAME_RE.test(name)) return { ok: false, error: "技能名不符合规范：" + name };

	const root =
		scope === "user"
			? nodePath.join(nodeOs.homedir(), ".dsh", "skills")
			: nodePath.join(cwd || process.cwd(), ".dsh", "skills");
	const dir = nodePath.join(root, name);
	const file = nodePath.join(dir, "SKILL.md");

	try {
		nodeFs.mkdirSync(dir, { recursive: true });
		nodeFs.writeFileSync(file, draft.content, "utf-8");
	} catch (e) {
		return { ok: false, error: "写入失败: " + e.message };
	}

	const now = Date.now();
	db.prepare(
		"UPDATE skill_draft SET status = 'published', published_path = ?, updated_at = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?",
	).run(file, now, now, id);

	return { ok: true, draft_id: id, name, path: file, scope };
}

// 外部（如 dsh-drop-md 拖入的 SKILL.md）导入为已发布的程序记忆
export function importSkillMd(db, sessionId, content, meta = {}) {
	if (!db) return { ok: false, error: "database not initialized" };
	const text = String(content || "");
	if (!text.trim()) return { ok: false, error: "内容为空" };

	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	let name = meta.name || "";
	let description = meta.description || "";
	let whenToUse = meta.whenToUse || "";
	let body = text;

	if (m) {
		const fm = {};
		for (const line of m[1].split(/\r?\n/)) {
			const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
			if (kv) fm[kv[1]] = kv[2].replace(/^['"]|['"]$/g, "");
		}
		name = name || fm.name || "";
		description = description || fm.description || "";
		whenToUse = whenToUse || fm.whenToUse || "";
		body = text;
	}

	if (!name) {
		const h1 = /^#\s+(.+)$/m.exec(text);
		name = h1 ? h1[1].trim() : "imported-skill";
	}
	if (!description) {
		description = String(body.replace(/^---[\s\S]*?---/, "").replace(/^#.*$/m, "").trim().split(/\n\n/)[0] || "").slice(0, 160) || name;
	}

	const slug = slugify(name, "imported-skill");
	const now = Date.now();
	const info = db
		.prepare(
			`INSERT INTO skill_draft
			 (session_id, name, description, when_to_use, content, source, status, published_path, created_at, updated_at, reviewed_at)
			 VALUES (?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?)`,
		)
		.run(sessionId, slug, String(description).slice(0, 200), String(whenToUse), text, meta.publishedPath ? "published" : "approved", meta.publishedPath || null, now, now, now);

	return { ok: true, draft_id: info.lastInsertRowid, name: slug, description, status: meta.publishedPath ? "published" : "approved" };
}

export function deleteSkillDraft(db, id) {
	if (!db) return { ok: false, error: "database not initialized" };
	const draft = getSkillDraft(db, id);
	if (!draft) return { ok: false, error: "草稿不存在" };
	db.prepare("DELETE FROM skill_draft WHERE id = ?").run(id);
	return { ok: true, deleted_id: id, name: draft.name };
}
