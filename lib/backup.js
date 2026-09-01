// dsh-memory-nexus — 备份与迁移模块（P3）
//
// 支持：
//   1. 导出：将语义记忆/知识图谱导出为 JSON/Markdown 文件
//   2. 导入：从文件导入记忆（跨会话/跨设备迁移）
//   3. 离线迁移：生成可离线传输的打包文件（zip-like，实际用 tar 或分卷）
//
// 格式说明：
//   - JSON 格式：完整结构化，含 metadata.version
//   - Markdown 格式：人类可读，可用于 git 版本管理

import nodeFs from "node:fs";
import nodePath from "node:path";

const EXPORT_VERSION = "1.0";
const EXPORT_TYPE = "dsh-memory-nexus";

// ============== 导出功能 ==============

/**
 * 导出语义记忆为 JSON
 * @param {object} db - SQLite 数据库连接
 * @param {string} sessionId - 会话 ID（null = 全部）
 * @param {object} options - 导出选项
 * @returns {object} 导出结果
 */
export function exportSemantic(db, sessionId = null, options = {}) {
	if (!db) return { ok: false, error: "database not initialized" };

	const now = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
	const query = sessionId ? "WHERE session_id = ?" : "";
	const params = sessionId ? [sessionId] : [];

	// 导出 semantic 表
	const facts = db.prepare(
		`SELECT id, session_id, content, kind, importance, tags, created_at, updated_at, expires_at, pinned, source, version
		 FROM semantic ${query}
		 ORDER BY created_at ASC`,
	).all(...params);

	// 导出 graph_node 表
	const nodes = db.prepare(
		`SELECT id, session_id, title, content, node_type, weight, created_at, updated_at
		 FROM graph_node ${query}
		 ORDER BY created_at ASC`,
	).all(...params);

	// 导出 graph_edge 表
	const edges = db.prepare(
		`SELECT id, session_id, source_id, target_id, relation, weight, created_at
		 FROM graph_edge ${query}
		 ORDER BY created_at ASC`,
	).all(...params);

	// 导出 skill_draft（仅已发布）
	const skills = db.prepare(
		`SELECT id, session_id, name, description, when_to_use, content, source, status, published_path, created_at, updated_at
		 FROM skill_draft ${query}
		 WHERE status IN ('published', 'approved')
		 ORDER BY created_at ASC`,
	).all(...params);

	const exportData = {
		version: EXPORT_VERSION,
		type: EXPORT_TYPE,
		exported_at: new Date().toISOString(),
		session_id: sessionId || "all",
		statistics: {
			facts: facts.length,
			nodes: nodes.length,
			edges: edges.length,
			skills: skills.length,
		},
		data: {
			semantic: facts,
			graph_nodes: nodes,
			graph_edges: edges,
			skills: skills,
		},
	};

	return {
		ok: true,
		data: exportData,
		format: "json",
		fileName: `memory-export-${sessionId || "all"}-${now}.json`,
	};
}

/**
 * 导出语义记忆为 Markdown（人类可读格式）
 */
export function exportSemanticMd(db, sessionId = null, options = {}) {
	const jsonResult = exportSemantic(db, sessionId, options);
	if (!jsonResult.ok) return jsonResult;

	const lines = [
		`# 记忆导出 — ${jsonResult.data.session_id}`,
		``,
		`- 导出时间: ${jsonResult.data.exported_at}`,
		`- 格式版本: ${EXPORT_VERSION}`,
		`- 统计: ${jsonResult.data.statistics.facts} 条事实, ${jsonResult.data.statistics.nodes} 个节点, ${jsonResult.data.statistics.edges} 条边, ${jsonResult.data.statistics.skills} 个技能`,
		``,
		`---`,
		``,
		`## 语义记忆 (${jsonResult.data.statistics.facts} 条)`,
		``,
	];

	for (const fact of jsonResult.data.data.semantic) {
		const pinned = fact.pinned ? " 🔒" : "";
		const expires = fact.expires_at ? new Date(fact.expires_at).toLocaleString("zh-CN") : "永不过期";
		const tags = Array.isArray(fact.tags) ? fact.tags.join(", ") : "[]";
		lines.push(
			`### ${fact.kind}${pinned}`,
			``,
			`**内容**: ${fact.content}`,
			`**重要性**: ${fact.importance}`,
			`**标签**: ${tags}`,
			`**来源**: ${fact.source || "agent"}`,
			`**过期**: ${expires}`,
			`**版本**: v${fact.version || 1}`,
			``,
			`---`,
			``,
		);
	}

	lines.push(`## 知识图谱 (${jsonResult.data.statistics.nodes} 节点, ${jsonResult.data.statistics.edges} 边)`);
	lines.push("");
	for (const node of jsonResult.data.data.graph_nodes) {
		lines.push(`- **${node.title}** (${node.node_type}, 权重:${node.weight})`);
	}
	lines.push("");
	lines.push("#### 边关系");
	for (const edge of jsonResult.data.data.graph_edges) {
		lines.push(`- ${edge.source_id} --[${edge.relation}]--> ${edge.target_id}`);
	}
	lines.push("");

	lines.push(`## 程序记忆 (${jsonResult.data.statistics.skills} 个)`);
	lines.push("");
	for (const skill of jsonResult.data.data.skills) {
		lines.push(`### ${skill.name}`);
		lines.push(`状态: ${skill.status}`);
		lines.push(`描述: ${skill.description}`);
		lines.push("");
	}

	lines.push(`---`);
	lines.push(`*由 dsh-memory-nexus 自动生成*`);

	return {
		...jsonResult,
		format: "markdown",
		fileName: `memory-export-${sessionId || "all"}-${now}.md`,
		content: lines.join("\n"),
	};
}

// ============== 导入功能 ==============

/**
 * 从 JSON 导入记忆
 * @param {object} db - SQLite 数据库连接
 * @param {string} targetSessionId - 目标会话 ID
 * @param {object} data - 导入数据（exportSemantic 返回的 data 字段）
 * @param {object} options - 导入选项（conflict: 'skip'|'overwrite'|'merge'）
 * @returns {object} 导入结果统计
 */
export function importSemantic(db, targetSessionId, data, options = {}) {
	if (!db) return { ok: false, error: "database not initialized" };
	if (!data || !data.version) return { ok: false, error: "无效的数据格式" };

	const conflict = options.conflict || "skip"; // skip | overwrite | merge
	const result = {
		ok: true,
		imported: { semantic: 0, nodes: 0, edges: 0, skills: 0 },
		skipped: { semantic: 0, nodes: 0, edges: 0, skills: 0 },
		merged: { semantic: 0 },
		source_session: data.session_id,
	};

	// 导入 semantic
	for (const fact of data.data?.semantic || []) {
		const existing = db.prepare(
			`SELECT id FROM semantic WHERE session_id = ? AND content = ? LIMIT 1`,
		).get(targetSessionId, fact.content);

		if (existing) {
			if (conflict === "skip") {
				result.skipped.semantic += 1;
			} else if (conflict === "overwrite") {
				db.prepare(`
					UPDATE semantic SET kind=?, importance=?, tags=?, source=?, updated_at=?, expires_at=?
					WHERE id=?
				`).run(fact.kind, fact.importance, fact.tags, fact.source, Date.now(), fact.expires_at, existing.id);
				result.merged.semantic += 1;
			} else {
				result.skipped.semantic += 1;
			}
		} else {
			db.prepare(`
				INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at, source, pinned)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				targetSessionId,
				fact.content,
				fact.kind,
				fact.importance,
				fact.tags || "[]",
				fact.created_at || Date.now(),
				Date.now(),
				fact.expires_at,
				fact.source || "imported",
				fact.pinned ? 1 : 0,
			);
			result.imported.semantic += 1;
		}
	}

	// 导入 graph_node
	for (const node of data.data?.graph_nodes || []) {
		const existing = db.prepare(
			`SELECT id FROM graph_node WHERE session_id = ? AND title = ? LIMIT 1`,
		).get(targetSessionId, node.title);

		if (existing) {
			result.skipped.nodes += 1;
		} else {
			db.prepare(`
				INSERT INTO graph_node (session_id, title, content, node_type, weight, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(
				targetSessionId,
				node.title,
				node.content || "",
				node.node_type || "concept",
				node.weight || 1,
				node.created_at || Date.now(),
				Date.now(),
			);
			result.imported.nodes += 1;
		}
	}

	// 导入 graph_edge（跳过自环）
	for (const edge of data.data?.graph_edges || []) {
		if (edge.source_id === edge.target_id) {
			result.skipped.edges += 1;
			continue;
		}
		// 检查是否已存在
		const existing = db.prepare(
			`SELECT id FROM graph_edge WHERE session_id = ? AND source_id = ? AND target_id = ? AND relation = ? LIMIT 1`,
		).get(targetSessionId, edge.source_id, edge.target_id, edge.relation || "related");

		if (existing) {
			result.skipped.edges += 1;
		} else {
			db.prepare(`
				INSERT INTO graph_edge (session_id, source_id, target_id, relation, weight, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
			`).run(
				targetSessionId,
				edge.source_id,
				edge.target_id,
				edge.relation || "related",
				edge.weight || 1,
				edge.created_at || Date.now(),
			);
			result.imported.edges += 1;
		}
	}

	// 导入 skill（仅 published/approved）
	for (const skill of data.data?.skills || []) {
		const existing = db.prepare(
			`SELECT id FROM skill_draft WHERE session_id = ? AND name = ? LIMIT 1`,
		).get(targetSessionId, skill.name);

		if (existing) {
			result.skipped.skills += 1;
		} else {
			db.prepare(`
				INSERT INTO skill_draft (session_id, name, description, when_to_use, content, source, status, published_path, created_at, updated_at, reviewed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				targetSessionId,
				skill.name,
				skill.description || "",
				skill.when_to_use || "",
				skill.content || "",
				skill.source || "imported",
				skill.status || "approved",
				skill.published_path || null,
				skill.created_at || Date.now(),
				Date.now(),
				skill.reviewed_at || null,
			);
			result.imported.skills += 1;
		}
	}

	return result;
}

/**
 * 从文件导入记忆（自动检测格式）
 * @param {string} dbPath - SQLite 数据库路径
 * @param {string} filePath - 导入文件路径（JSON 或 Markdown）
 * @param {string} targetSessionId - 目标会话 ID
 * @param {object} options - 导入选项
 */
export async function importFromFile(db, filePath, targetSessionId, options = {}) {
	if (!db) return { ok: false, error: "database not initialized" };

	const ext = nodePath.extname(filePath).toLowerCase();
	const content = nodeFs.readFileSync(filePath, "utf-8");

	if (ext === ".json") {
		let data;
		try {
			data = JSON.parse(content);
		} catch (e) {
			return { ok: false, error: "JSON 解析失败: " + e.message };
		}
		return importSemantic(db, targetSessionId, data, options);
	}

	if (ext === ".md") {
		return { ok: false, error: "Markdown 导入暂不支持，请使用 JSON 格式" };
	}

	return { ok: false, error: "不支持的文件格式: " + ext };
}

// ============== 离线迁移包（轻量 zip 替代） ==============

/**
 * 生成可离线传输的记忆包
 * 格式：tar.gz 的简化版（实际使用多文件打包）
 * 返回包含所有数据的单个 JSON 文件
 */
export function createMigrationPackage(db, sessionId, options = {}) {
	const exportResult = exportSemantic(db, sessionId, options);
	if (!exportResult.ok) return exportResult;

	const pkg = {
		...exportResult.data,
		metadata: {
			package_version: "1.0",
			compatible_with: ["dsh-memory-nexus >= 0.1.0"],
			created_by: "dsh-memory-nexus",
			options: options,
		},
		checksum: null, // 可由调用方计算
	};

	return {
		ok: true,
		package: pkg,
		fileName: `memory-migration-${sessionId || "all"}-${new Date().toISOString().slice(0, 10)}.pkg.json`,
		sizeBytes: Buffer.byteLength(JSON.stringify(pkg)),
	};
}

/**
 * 验证迁移包完整性
 */
export function validateMigrationPackage(pkg) {
	if (!pkg || !pkg.version || !pkg.type || !pkg.data) {
		return { ok: false, error: "无效的迁移包格式" };
	}

	const requiredKeys = ["semantic", "graph_nodes", "graph_edges", "skills"];
	const missing = requiredKeys.filter((k) => !pkg.data[k]);
	if (missing.length > 0) {
		return { ok: false, error: `缺少必要字段: ${missing.join(", ")}` };
	}

	return {
		ok: true,
		version: pkg.version,
		statistics: pkg.statistics,
		valid: true,
	};
}

// ============== API 路由处理（在 index.js 中调用） ==============

/**
 * 导出记忆为文件（供 HTTP 路由使用）
 */
export async function handleExport(db, sessionId, format = "json", options = {}) {
	const result = format === "markdown"
		? exportSemanticMd(db, sessionId, options)
		: exportSemantic(db, sessionId, options);

	if (!result.ok) return result;

	const filePath = nodePath.join(options.outputDir || process.cwd(), result.fileName);
	nodeFs.writeFileSync(filePath, format === "markdown" ? result.content : JSON.stringify(result.data, null, 2), "utf-8");

	return {
		...result,
		filePath,
		fileSize: nodeFs.statSync(filePath).size,
	};
}

/**
 * 导入记忆从文件（供 HTTP 路由使用）
 */
export async function handleImport(db, sessionId, filePath, options = {}) {
	return importFromFile(db, filePath, sessionId, options);
}
