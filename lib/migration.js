// dsh-memory-nexus — 跨插件记忆迁移模块
//
// 扫描 DSH 已安装的其他记忆插件数据源，将已有记忆导入本插件的 semantic 表，
// 防止用户切换/新增插件时丢失历史记忆。
//
// 支持的数据源：
//   1. dsh-memoir     — ~/.dsh/dsh-memoir.json（JSON 结构化条目）
//   2. dsh-auto-memory — ~/.dsh/memory/workspaces/<project>/MEMORY.md（Markdown）
//   3. WorkBuddy Memory — ~/.workbuddy/memory/MEMORY.md（Markdown，跨项目）
//
// 导入策略：
//   - 重复检测：相同内容跳过，避免污染数据库
//   - TTL 映射：work → fact(30天), lessons → lesson(90天), actions → chat(7天)
//   - 优先保留高重要性条目（importance >= 3）
//   - 全部标记 source='imported:memoir|auto-memory|workbuddy'

import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeOs from "node:os";

// ============== 数据源路径解析 ==============

/** 解析 ~ 开头的路径 */
function expandHome(p) {
	if (!p) return "";
	return p.replace(/^~/, nodeOs.homedir());
}

/** 获取 memoir 文件路径 */
export function getMemoirPath() {
	return expandHome("~/.dsh/dsh-memoir.json");
}

/** 获取 auto-memory 配置路径 */
export function getAutoMemoryConfigPath() {
	return expandHome("~/.dsh/dsh-auto-memory.json");
}

/** 获取 auto-memory 工作空间列表 */
export function getAutoMemoryWorkspaceDir() {
	return expandHome("~/.dsh/memory/workspaces");
}

/** 获取 WorkBuddy 记忆文件路径 */
export function getWorkBuddyMemoryPath() {
	return expandHome("~/.workbuddy/memory/MEMORY.md");
}

// ============== 格式解析 ==============

/** 读取 JSON 文件，失败返回 null */
function readJsonFile(path) {
	if (!path || !nodeFs.existsSync(path)) return null;
	try {
		return JSON.parse(nodeFs.readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/** 读取文本文件，失败返回 null */
function readTextFile(path) {
	if (!path || !nodeFs.existsSync(path)) return null;
	try {
		return nodeFs.readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

// ============== dsh-memoir 解析 ==============

/**
 * 解析 dsh-memoir.json 为语义记忆条目
 * section 映射：work→fact, lessons→lesson, actions→chat
 */
export function parseMemoir(data) {
	if (!data || typeof data !== "object") return [];
	const entries = [];

	const SECTION_MAP = {
		work: "fact",
		lessons: "lesson",
		actions: "chat",
	};

	for (const [projPath, proj] of Object.entries(data.projects || {})) {
		const title = proj.title || projPath;
		for (const entry of proj.entries || []) {
			const section = entry.section || "work";
			const kind = SECTION_MAP[section] || "fact";
			const content = `[${title}] ${entry.title || ""}: ${entry.content || ""}`;
			const importance = Math.round(((entry.importance || 1) / 5) * 100) / 100; // 1-5 → 0.2-1.0
			const tags = Array.isArray(entry.tags) ? entry.tags : [];

			entries.push({
				content: content.trim(),
				kind,
				importance: Math.max(0.1, Math.min(1.0, importance)),
				tags,
				source: "imported:memoir",
				external_id: entry.id,
				external_proj: title,
				timestamp: entry.time || Date.now(),
			});
		}
	}

	return entries;
}

// ============== dsh-auto-memory 解析 ==============

/**
 * 解析 auto-memory 工作空间的 MEMORY.md 文件
 * 格式：# 标题 → content，## 章节 → kind 标记
 */
export function parseAutoMemoryMd(content, workspaceName) {
	if (!content) return [];
	const entries = [];

	// 按 ## 标题分块
	const blocks = content.split(/^## /m).filter((b) => b.trim());

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length < 2) continue;

		const title = lines[0].trim();
		const body = lines.slice(1).join("\n").trim();
		if (!body) continue;

		// 根据标题判断 kind
		let kind = "fact";
		if (title.includes("教训") || title.includes("经验")) kind = "lesson";
		else if (title.includes("用户") || title.includes("偏好")) kind = "core_preference";

		// 提取标签（从正文中的 #tag 或 ## 章节提取）
		const tags = [];
		const tagMatches = body.match(/#[\w\u4e00-\u9fa5]+/g) || [];
		for (const t of tagMatches.slice(0, 5)) tags.push(t.replace("#", ""));

		entries.push({
			content: `[${workspaceName}] ${title}\n\n${body.slice(0, 500)}`,
			kind,
			importance: kind === "core_preference" ? 1.0 : kind === "lesson" ? 0.8 : 0.6,
			tags,
			source: "imported:auto-memory",
			external_proj: workspaceName,
		});
	}

	return entries;
}

// ============== WorkBuddy Memory 解析 ==============

/**
 * 解析 WorkBuddy 的 MEMORY.md
 * 直接作为 core_preference 导入
 */
export function parseWorkBuddyMemory(content) {
	if (!content) return [];
	const entries = [];

	// 按二级标题分块
	const blocks = content.split(/^## /m).filter((b) => b.trim());

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length < 2) continue;

		const title = lines[0].trim();
		const body = lines.slice(1).join("\n").trim();
		if (!body || body.length < 20) continue;

		entries.push({
			content: `[WorkBuddy] ${title}\n\n${body.slice(0, 800)}`,
			kind: "core_preference",
			importance: 0.9,
			tags: [],
			source: "imported:workbuddy",
		});
	}

	// 如果没有二级标题，整体作为一条导入
	if (entries.length === 0 && content.length > 100) {
		entries.push({
			content: `[WorkBuddy] 用户长期记忆\n\n${content.slice(0, 1000)}`,
			kind: "core_preference",
			importance: 0.95,
			tags: [],
			source: "imported:workbuddy",
		});
	}

	return entries;
}

// ============== 去重检测 ==============

/**
 * 检测数据库中是否已存在相同内容（基于 content hash）
 */
export function findExistingHashes(db, sessionId, contents) {
	if (!db || !contents.length) return new Set();

	const hashes = [];
	for (const c of contents) {
		hashes.push(c.content.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100));
	}

	// 用 LIKE 模糊匹配检测重复（简单实现）
	const existing = new Set();
	for (const h of hashes) {
		if (db.prepare(
			`SELECT id FROM semantic WHERE session_id = ? AND content LIKE ? LIMIT 1`,
		).get(sessionId, `%${h.slice(0, 30)}%`)) {
			existing.add(h);
		}
	}

	return existing;
}

// ============== 主迁移函数 ==============

/**
 * 执行跨插件记忆迁移
 * @param {object} db - SQLite 数据库连接
 * @param {string} sessionId - 目标会话 ID
 * @param {object} options - 迁移选项
 * @returns {object} 迁移结果统计
 */
export function migrateFromOtherPlugins(db, sessionId, options = {}) {
	if (!db) return { ok: false, error: "database not initialized" };

	const result = {
		ok: true,
		imported: 0,
		skipped: 0,
		sources: {},
	};

	// ============ 1. dsh-memoir ============
	try {
		const memoirPath = getMemoirPath();
		const memoirData = readJsonFile(memoirPath);
		if (memoirData) {
			const entries = parseMemoir(memoirData);
			const existing = findExistingHashes(db, sessionId, entries);

			let imported = 0;
			for (const entry of entries) {
				const key = entry.content.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);
				if (existing.has(key)) {
					result.skipped += 1;
					continue;
				}

				// 计算 TTL
				const ttl = entry.kind === "core_preference" ? null :
					entry.kind === "lesson" ? Date.now() + 90 * 24 * 3600 * 1000 :
					entry.kind === "chat" ? Date.now() + 7 * 24 * 3600 * 1000 :
					Date.now() + 30 * 24 * 3600 * 1000;

				db.prepare(`
					INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at, source)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					sessionId,
					entry.content,
					entry.kind,
					entry.importance,
					JSON.stringify(entry.tags),
					entry.timestamp || Date.now(),
					Date.now(),
					ttl,
					entry.source,
				);
				imported += 1;
			}

			result.imported += imported;
			result.sources.memoir = { total: entries.length, imported, skipped: entries.length - imported };
		}
	} catch (e) {
		result.sources.memoir = { error: e.message };
	}

	// ============ 2. dsh-auto-memory ============
	try {
		const workspaceDir = getAutoMemoryWorkspaceDir();
		if (nodeFs.existsSync(workspaceDir)) {
			const workspaces = nodeFs.readdirSync(workspaceDir, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name);

			let totalImported = 0;
			for (const ws of workspaces) {
				const mdPath = nodePath.join(workspaceDir, ws, "MEMORY.md");
				const content = readTextFile(mdPath);
				if (!content) continue;

				const entries = parseAutoMemoryMd(content, ws);
				const existing = findExistingHashes(db, sessionId, entries);

				let imported = 0;
				for (const entry of entries) {
					const key = entry.content.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);
					if (existing.has(key)) {
						result.skipped += 1;
						continue;
					}

					db.prepare(`
						INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at, source)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					`).run(
						sessionId,
						entry.content,
						entry.kind,
						entry.importance,
						JSON.stringify(entry.tags),
						Date.now(),
						Date.now(),
						entry.kind === "core_preference" ? null : Date.now() + 30 * 24 * 3600 * 1000,
						entry.source,
					);
					imported += 1;
				}
				totalImported += imported;
			}

			result.imported += totalImported;
			result.sources["auto-memory"] = {
				workspacesScanned: workspaces.length,
				imported: totalImported,
			};
		}
	} catch (e) {
		result.sources["auto-memory"] = { error: e.message };
	}

	// ============ 3. WorkBuddy Memory ============
	try {
		const wbPath = getWorkBuddyMemoryPath();
		const content = readTextFile(wbPath);
		if (content) {
			const entries = parseWorkBuddyMemory(content);
			const existing = findExistingHashes(db, sessionId, entries);

			let imported = 0;
			for (const entry of entries) {
				const key = entry.content.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);
				if (existing.has(key)) {
					result.skipped += 1;
					continue;
				}

				db.prepare(`
					INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at, source)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					sessionId,
					entry.content,
					entry.kind,
					entry.importance,
					JSON.stringify(entry.tags),
					Date.now(),
					Date.now(),
					null, // core_preference 永不过期
					entry.source,
				);
				imported += 1;
			}

			result.imported += imported;
			result.sources.workbuddy = { total: entries.length, imported, skipped: entries.length - imported };
		}
	} catch (e) {
		result.sources.workbuddy = { error: e.message };
	}

	return result;
}

/**
 * 检查有哪些记忆插件可用
 */
export function detectMemoryPlugins() {
	const plugins = [];

	// 检查 memoir
	if (nodeFs.existsSync(getMemoirPath())) {
		const data = readJsonFile(getMemoirPath());
		const totalEntries = Object.values(data?.projects || {}).reduce(
			(sum, p) => sum + (p.entries || []).length, 0
		);
		plugins.push({
			name: "dsh-memoir",
			status: "active",
			entriesCount: totalEntries,
			path: getMemoirPath(),
		});
	}

	// 检查 auto-memory
	const wsDir = getAutoMemoryWorkspaceDir();
	if (nodeFs.existsSync(wsDir)) {
		const wsCount = nodeFs.readdirSync(wsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory()).length;
		plugins.push({
			name: "dsh-auto-memory",
			status: "active",
			workspaces: wsCount,
			path: wsDir,
		});
	}

	// 检查 WorkBuddy Memory
	if (nodeFs.existsSync(getWorkBuddyMemoryPath())) {
		plugins.push({
			name: "workbuddy-memory",
			status: "active",
			path: getWorkBuddyMemoryPath(),
		});
	}

	return plugins;
}
