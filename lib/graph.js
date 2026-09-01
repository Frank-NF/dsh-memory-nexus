// dsh-memory-nexus — 知识图谱（P2）
//
// 节点 + 边的轻量图谱，支持：
//   - Obsidian 风格 [[双向链接]] 自动解析入库
//   - 全局视图 / 局部邻域（BFS）/ 全文检索 / 图谱召回
//
// 所有函数为同步实现（better-sqlite3 同步 API）。

const WIKI_LINK_RE = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;
const DEFAULT_RELATION = "related";

export function upsertNode(db, sessionId, title, content = "", nodeType = "concept") {
	if (!db) return null;
	const cleanTitle = String(title || "").trim();
	if (!cleanTitle) return null;

	const now = Date.now();
	const existing = db
		.prepare("SELECT id, weight, content FROM graph_node WHERE session_id = ? AND title = ?")
		.get(sessionId, cleanTitle);

	if (existing) {
		const merged = content && content.length > (existing.content || "").length ? content : existing.content;
		db.prepare(
			"UPDATE graph_node SET content = ?, weight = weight + 1, updated_at = ? WHERE id = ?",
		).run(merged || existing.content || "", now, existing.id);
		return existing.id;
	}

	const info = db
		.prepare(
			`INSERT INTO graph_node (session_id, title, content, node_type, weight, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 1, ?, ?)`,
		)
		.run(sessionId, cleanTitle, String(content || ""), nodeType || "concept", now, now);
	return info.lastInsertRowid;
}

export function linkNodes(db, sessionId, sourceTitle, targetTitle, relation = DEFAULT_RELATION, weight = 1) {
	if (!db) return { ok: false, error: "database not initialized" };
	if (!sourceTitle || !targetTitle) return { ok: false, error: "缺少节点名" };
	if (String(sourceTitle).trim() === String(targetTitle).trim()) return { ok: false, error: "不能自环" };

	const sourceId = upsertNode(db, sessionId, sourceTitle, "", "concept");
	const targetId = upsertNode(db, sessionId, targetTitle, "", "concept");
	if (!sourceId || !targetId) return { ok: false, error: "节点创建失败" };

	try {
		db.prepare(
			`INSERT INTO graph_edge (session_id, source_id, target_id, relation, weight, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(source_id, target_id, relation) DO UPDATE SET weight = weight + 1`,
		).run(sessionId, sourceId, targetId, relation || DEFAULT_RELATION, weight, Date.now());
	} catch (e) {
		return { ok: false, error: e.message };
	}

	return { ok: true, source_id: sourceId, target_id: targetId, relation: relation || DEFAULT_RELATION };
}

// 解析一段文本中的 [[链接]]，source 节点指向所有链接目标
export function parseWikiLinks(db, sessionId, text, sourceTitle = null, nodeType = "note") {
	if (!db) return { ok: false, error: "database not initialized" };
	const body = String(text || "");
	const matches = Array.from(body.matchAll(WIKI_LINK_RE));
	if (matches.length === 0) return { ok: true, nodes: 0, edges: 0, links: [] };

	const now = Date.now();
	const tx = db.transaction(() => {
		const sourceId = sourceTitle ? upsertNode(db, sessionId, sourceTitle, body.slice(0, 2000), nodeType) : null;
		const links = [];
		for (const m of matches) {
			const target = String(m[1] || "").trim();
			if (!target) continue;
			const targetId = upsertNode(db, sessionId, target, "", "concept");
			if (!targetId) continue;
			if (sourceId) {
				db.prepare(
					`INSERT INTO graph_edge (session_id, source_id, target_id, relation, weight, created_at)
					 VALUES (?, ?, ?, 'links', 1, ?)
					 ON CONFLICT(source_id, target_id, relation) DO UPDATE SET weight = weight + 1`,
				).run(sessionId, sourceId, targetId, now);
			}
			links.push({ target, node_id: targetId });
		}
		return { sourceId, links };
	});

	const result = tx();
	return {
		ok: true,
		source_node_id: result.sourceId,
		nodes: result.links.length,
		edges: result.sourceId ? result.links.length : 0,
		links: result.links,
	};
}

function neighborMap(db, sessionId) {
	const rows = db
		.prepare(
			`SELECT e.source_id, e.target_id, e.relation, e.weight,
			        s.title AS source_title, t.title AS target_title
			 FROM graph_edge e
			 JOIN graph_node s ON s.id = e.source_id
			 JOIN graph_node t ON t.id = e.target_id
			 WHERE e.session_id = ?`,
		)
		.all(sessionId);
	const map = new Map();
	const push = (from, to, relation, weight) => {
		if (!map.has(from)) map.set(from, []);
		map.get(from).push({ id: to, relation, weight });
	};
	for (const r of rows) {
		push(r.source_id, r.target_id, r.relation, r.weight);
		push(r.target_id, r.source_id, r.relation, r.weight); // 双向可走
	}
	return map;
}

// 全局视图：按节点度数取 top N
export function viewGlobal(db, sessionId, limit = 80) {
	if (!db) return { nodes: [], edges: [], total: 0, error: "database not initialized" };

	const degreeRows = db
		.prepare(
			`SELECT n.id, n.title, n.node_type, n.content, n.weight,
			        (SELECT COUNT(*) FROM graph_edge e WHERE e.source_id = n.id OR e.target_id = n.id) AS degree
			 FROM graph_node n WHERE n.session_id = ?
			 ORDER BY degree DESC, n.weight DESC LIMIT ?`,
		)
		.all(sessionId, limit);

	const ids = degreeRows.map((r) => r.id);
	if (ids.length === 0) return { nodes: [], edges: [], total: 0 };

	const placeholders = ids.map(() => "?").join(",");
	const edges = db
		.prepare(
			`SELECT e.id, e.source_id, e.target_id, e.relation, e.weight
			 FROM graph_edge e
			 WHERE e.source_id IN (${placeholders}) AND e.target_id IN (${placeholders})`,
		)
		.all(...ids, ...ids);

	return {
		nodes: degreeRows.map((r) => ({
			id: r.id,
			title: r.title,
			node_type: r.node_type,
			excerpt: String(r.content || "").slice(0, 120),
			weight: r.weight,
			degree: r.degree,
		})),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source_id,
			target: e.target_id,
			relation: e.relation,
			weight: e.weight,
		})),
		total: degreeRows.length,
	};
}

// 局部邻域：以某节点为中心做 BFS，depth 跳以内
export function viewLocal(db, sessionId, centerTitle, depth = 1, limit = 60) {
	if (!db) return { nodes: [], edges: [], error: "database not initialized" };

	const center = db
		.prepare("SELECT id, title, node_type, content, weight FROM graph_node WHERE session_id = ? AND title = ?")
		.get(sessionId, String(centerTitle || "").trim());
	if (!center) return { ok: false, error: "节点不存在: " + centerTitle };

	const adj = neighborMap(db, sessionId);
	const visited = new Set([center.id]);
	let frontier = [center.id];
	const levels = new Map([[center.id, 0]]);

	for (let d = 0; d < Math.max(1, depth); d += 1) {
		const next = [];
		for (const id of frontier) {
			for (const nb of adj.get(id) || []) {
				if (visited.has(nb.id)) continue;
				visited.add(nb.id);
				levels.set(nb.id, d + 1);
				next.push(nb.id);
			}
		}
		frontier = next;
		if (frontier.length === 0) break;
	}

	const ids = Array.from(visited).slice(0, limit);
	const placeholders = ids.map(() => "?").join(",");
	const nodeRows = db
		.prepare(`SELECT id, title, node_type, content, weight FROM graph_node WHERE id IN (${placeholders})`)
		.all(...ids);
	const edgeRows = db
		.prepare(
			`SELECT id, source_id, target_id, relation, weight FROM graph_edge
			 WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`,
		)
		.all(...ids, ...ids);

	return {
		ok: true,
		center: { id: center.id, title: center.title },
		depth,
		nodes: nodeRows.map((r) => ({
			id: r.id,
			title: r.title,
			node_type: r.node_type,
			excerpt: String(r.content || "").slice(0, 120),
			weight: r.weight,
			level: levels.get(r.id) || 0,
		})),
		edges: edgeRows.map((e) => ({
			id: e.id,
			source: e.source_id,
			target: e.target_id,
			relation: e.relation,
			weight: e.weight,
		})),
	};
}

export function searchNodes(db, sessionId, query, limit = 20) {
	if (!db) return { nodes: [], total: 0, error: "database not initialized" };
	if (!query) return viewGlobal(db, sessionId, limit);

	const escapedQuery = String(query).replace(/[%_]/g, (m) => "\\" + m);
	let rows = [];

	try {
		rows = db
			.prepare(
				`SELECT n.id, n.title, n.content, n.node_type, n.weight, f.rank
				 FROM graph_node_fts f JOIN graph_node n ON n.id = f.rowid
				 WHERE graph_node_fts MATCH ? AND n.session_id = ?
				 ORDER BY rank LIMIT ?`,
			)
			.all(query, sessionId, limit);
	} catch {
		// FTS 不可用时退化为 LIKE
	}

	// FTS 无结果或异常时，回退到 LIKE 模糊匹配
	if ((!rows || rows.length === 0) && db) {
		const like = "%" + escapedQuery + "%";
		rows = db
			.prepare(
				`SELECT id, title, content, node_type, weight, 0 AS rank FROM graph_node
				 WHERE session_id = ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
				 ORDER BY weight DESC LIMIT ?`,
			)
			.all(sessionId, like, like, limit);
	}

	return {
		nodes: (rows || []).map((r) => ({
			id: r.id,
			title: r.title,
			node_type: r.node_type,
			excerpt: String(r.content || "").slice(0, 120),
			weight: r.weight,
		})),
		total: (rows || []).length,
	};
}

// 图谱召回：命中节点 + 一跳邻居 + 关联的情景记忆片段
export function recallByGraph(db, sessionId, query, limit = 5) {
	if (!db) return { nodes: [], related_messages: [], error: "database not initialized" };
	const found = searchNodes(db, sessionId, query, limit);
	if (!found.nodes || found.nodes.length === 0) return { nodes: [], related_messages: [], total: 0 };

	const adj = neighborMap(db, sessionId);
	const centerIds = new Set(found.nodes.map((n) => n.id));
	const neighborIds = new Set();
	for (const id of centerIds) {
		for (const nb of adj.get(id) || []) {
			if (!centerIds.has(nb.id)) neighborIds.add(nb.id);
		}
	}

	const allIds = Array.from(new Set([...centerIds, ...neighborIds]));
	const placeholders = allIds.map(() => "?").join(",");
	const nodeRows = db
		.prepare(`SELECT id, title, content, node_type FROM graph_node WHERE id IN (${placeholders})`)
		.all(...allIds);

	const titles = nodeRows.map((r) => r.title);
	let relatedMessages = [];
	if (titles.length > 0) {
		// 用节点标题做关键词，回到 L2 情景记忆里找相关片段
		const clauses = titles.slice(0, 6).map(() => "content LIKE ?").join(" OR ");
		relatedMessages = db
			.prepare(
				`SELECT id, role, content, timestamp FROM episodic
				 WHERE session_id = ? AND (${clauses}) ORDER BY timestamp DESC LIMIT 8`,
			)
			.all(sessionId, ...titles.slice(0, 6).map((t) => "%" + t + "%"));
	}

	return {
		ok: true,
		nodes: nodeRows.map((r) => ({
			id: r.id,
			title: r.title,
			node_type: r.node_type,
			excerpt: String(r.content || "").slice(0, 200),
			is_center: centerIds.has(r.id),
		})),
		related_messages: relatedMessages.map((m) => ({
			id: m.id,
			role: m.role,
			content: String(m.content).slice(0, 200),
			timestamp: m.timestamp,
		})),
		total: nodeRows.length,
	};
}

export function graphStats(db, sessionId) {
	if (!db) return { nodes: 0, edges: 0, isolated: 0, hubs: [], error: "database not initialized" };

	const nodes = db.prepare("SELECT COUNT(*) AS c FROM graph_node WHERE session_id = ?").get(sessionId);
	const edges = db.prepare("SELECT COUNT(*) AS c FROM graph_edge WHERE session_id = ?").get(sessionId);
	const isolated = db
		.prepare(
			`SELECT COUNT(*) AS c FROM graph_node n WHERE n.session_id = ?
			 AND NOT EXISTS (SELECT 1 FROM graph_edge e WHERE e.source_id = n.id OR e.target_id = n.id)`,
		)
		.get(sessionId);
	const hubs = db
		.prepare(
			`SELECT n.id, n.title, COUNT(*) AS degree
			 FROM graph_node n JOIN graph_edge e ON e.source_id = n.id OR e.target_id = n.id
			 WHERE n.session_id = ? GROUP BY n.id ORDER BY degree DESC LIMIT 8`,
		)
		.all(sessionId);

	return {
		nodes: nodes.c,
		edges: edges.c,
		isolated: isolated.c,
		hubs: hubs.map((h) => ({ id: h.id, title: h.title, degree: h.degree })),
	};
}

export function deleteNode(db, id) {
	if (!db) return { ok: false, error: "database not initialized" };
	const node = db.prepare("SELECT id, title FROM graph_node WHERE id = ?").get(id);
	if (!node) return { ok: false, error: "节点不存在" };
	db.prepare("DELETE FROM graph_edge WHERE source_id = ? OR target_id = ?").run(id, id);
	db.prepare("DELETE FROM graph_node WHERE id = ?").run(id);
	return { ok: true, deleted_id: id, title: node.title };
}
