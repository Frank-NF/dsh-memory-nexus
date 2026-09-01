// dsh-memory-nexus — 外部文档入库（跨插件联动入口）
//
// dsh-drop-md 拖入 Markdown 时调用：文档写入 L2 情景记忆，
// 章节结构与 [[双向链接]] 沉淀进知识图谱，让外部文档可被记忆检索。

import * as Graph from "./graph.js";
import { writeAudit } from "./audit.js";

// 粗略 token 估算：中文约 0.5 token/字，英文约 0.25 token/词
export function estimateTokens(text) {
	if (!text) return 0;
	const chineseChars = (String(text).match(/[^\x00-\x7F]/g) || []).length;
	const englishWords = (String(text).match(/\b\w+\b/g) || []).length;
	return Math.ceil(chineseChars * 0.5 + englishWords * 0.25);
}

// ============== 外部文档入库（供 dsh-drop-md 等插件联动） ==============

// 把一篇 Markdown 文档写入 L2 情景记忆，并把它的 [[双向链接]] 与章节结构沉淀进知识图谱
export async function ingestDocument(ctx, db, sessionId, payload = {}) {
	if (!db) return { ok: false, error: "database not initialized" };

	const name = String(payload.name || "未命名文档").trim();
	const content = String(payload.content || "");
	if (!content.trim()) return { ok: false, error: "文档内容为空" };

	// 1) 写入 L2（role=document，便于检索时区分来源）
	const header = "【文档:" + name + "】" + (payload.ref ? "(" + payload.ref + ")" : "");
	const text = header + "\n" + content;
	const info = db
		.prepare(
			`INSERT INTO episodic (session_id, timestamp, role, content, token_count, metadata)
			 VALUES (?, ?, 'document', ?, ?, ?)`,
		)
		.run(sessionId, Date.now(), text, estimateTokens(text), JSON.stringify({ source: "dsh-drop-md", file: name, ref: payload.ref || null }));

	// 2) 章节结构入图谱：文档节点 → 各二级标题节点
	const sectionTitles = Array.from(content.matchAll(/^##\s+(.+)$/gm)).map((m) => m[1].trim()).slice(0, 30);
	let sections = 0;
	if (sectionTitles.length > 0) {
		for (const title of sectionTitles) {
			const r = Graph.linkNodes(db, sessionId, name, title, "contains");
			if (r && r.ok) sections += 1;
		}
	} else {
		Graph.upsertNode(db, sessionId, name, content.slice(0, 500), "document");
	}

	// 3) [[双向链接]] 入图谱
	const wiki = Graph.parseWikiLinks(db, sessionId, content, name, "document");

	await writeAudit(db, sessionId, "user", "ingest_document", "episodic", info.lastInsertRowid, name);

	return {
		ok: true,
		message_id: info.lastInsertRowid,
		file: name,
		tokens: estimateTokens(text),
		graph: {
			sections: sections,
			wiki_links: wiki.links ? wiki.links.length : 0,
		},
	};
}
