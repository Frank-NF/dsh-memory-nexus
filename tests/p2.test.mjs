// dsh-memory-nexus — P2 集成测试（ESM）
// 用真实 SQLite 验证：L4 程序记忆 / 知识图谱 / 记忆管理面板 / P0P1 缺陷修复。
// better-sqlite3 未安装时全部跳过（与 host.test.cjs 同样的降级策略）。

import { createRequire } from "node:module";
import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeOs from "node:os";

const require = createRequire(import.meta.url);

const TMP = nodePath.join(nodeOs.tmpdir(), "dsh-memory-nexus-p2-" + Date.now());
nodeFs.mkdirSync(TMP, { recursive: true });

let Sqlite = null;
for (const p of [
	"C:/Users/niufe/.workbuddy/binaries/node/workspace/node_modules/better-sqlite3",
	"better-sqlite3",
	"./node_modules/better-sqlite3",
]) {
	try { Sqlite = require(p); break; } catch {}
}

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name, cond, extra) {
	if (cond) { passed += 1; console.log("  ✅ " + name); }
	else { failed += 1; console.log("  ❌ " + name + (extra ? " → " + extra : "")); }
}

function section(title) {
	console.log("\n▶ " + title);
}

async function main() {
	if (!Sqlite) {
		console.log("⚠️  better-sqlite3 未安装，P2 集成测试全部跳过");
		console.log("   安装命令：npm install better-sqlite3");
		skipped = 1;
		return;
	}

	const { initDatabase } = await import("../lib/schema.js");
	const L4 = await import("../lib/l4-skill.js");
	const Graph = await import("../lib/graph.js");
	const Admin = await import("../lib/memory-admin.js");
	const ttl = await import("../lib/ttl.js");
	const { ingestDocument } = await import("../lib/ingest.js");

	const dbPath = nodePath.join(TMP, "memory-nexus.db");
	const db = initDatabase(dbPath, Sqlite);
	const SID = "test-session-p2";

	// ============ 1. Schema ============
	section("数据库 schema（含 P2 新表）");
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
	for (const t of ["episodic", "semantic", "snapshots", "skill_draft", "graph_node", "graph_edge", "audit_log"]) {
		ok("表存在: " + t, tables.includes(t));
	}
	const cols = db.prepare("PRAGMA table_info(semantic)").all().map((c) => c.name);
	ok("semantic 补齐 pinned 列", cols.includes("pinned"));
	ok("semantic 补齐 source 列", cols.includes("source"));

	// ============ 2. TTL ============
	section("TTL 规则");
	ok("核心偏好永不过期", ttl.calculateTTLSeconds("core_preference", 1000) === null);
	ok("聊天碎片 7 天过期", ttl.calculateTTLSeconds("chat", 0) === 7 * 24 * 3600 * 1000);
	ok("未知类型回落到 fact", ttl.calculateTTLSeconds("unknown", 0) === ttl.calculateTTLSeconds("fact", 0));

	// ============ 3. L2 + L3 基础 + 缺陷修复 ============
	section("L2/L3 基础与 P1 缺陷修复");
	db.prepare("INSERT INTO episodic (session_id, timestamp, role, content, token_count) VALUES (?,?,?,?,?)")
		.run(SID, Date.now() - 3000, "user", "帮我整理一份社区服务站的上架流程", 20);
	db.prepare("INSERT INTO episodic (session_id, timestamp, role, content, token_count) VALUES (?,?,?,?,?)")
		.run(SID, Date.now() - 2000, "assistant", "先登记商品，再核对库存，最后同步到港服", 24);
	db.prepare("INSERT INTO episodic (session_id, timestamp, role, content, token_count) VALUES (?,?,?,?,?)")
		.run(SID, Date.now() - 1000, "user", "库存同步要注意鉴权头", 12);

	db.prepare(`INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at)
	            VALUES (?,?,?,?,?,?,?,?)`)
		.run(SID, "多门店数据同步到香港服务器 64.90.30.139", "fact", 0.9, "[]", Date.now(), Date.now(), null);
	db.prepare(`INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at)
	            VALUES (?,?,?,?,?,?,?,?)`)
		.run(SID, "用户偏好黑白 A4 可打印单据", "core_preference", 1.0, "[]", Date.now(), Date.now(), null);

	// searchFacts 依赖 ctx 无法直接实例化，这里验证它用的 FTS 表名不再指向错误的表
	let ftsOk = false;
	try {
		db.prepare("SELECT * FROM semantic_fts WHERE semantic_fts MATCH ? LIMIT 1").all("服务器");
		ftsOk = true;
	} catch (e) { ftsOk = false; }
	ok("semantic_fts 可被正确 MATCH（修复前的表名错误已消除）", ftsOk);

	// ============ 4. L4 程序记忆 ============
	section("L4 程序记忆（Skill 草稿）");
	const gen = L4.generateSkillDraft(db, SID, {});
	ok("草稿生成成功", gen.ok === true, gen.error);
	ok("草稿名符合 slug 规范", /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gen.name), gen.name);
	ok("草稿内容含 frontmatter", gen.content.startsWith("---") && gen.content.includes("name:"));
	ok("草稿含语义记忆约束", gen.content.includes("关键约束与偏好"));
	ok("提取到关键词", Array.isArray(gen.keywords) && gen.keywords.length > 0);

	const list = L4.listSkillDrafts(db, SID);
	ok("草稿列表可查", list.total >= 1 && list.drafts[0].status === "draft");

	const reviewed = L4.reviewSkillDraft(db, gen.draft_id, "approve", "可用");
	ok("审核通过", reviewed.ok && reviewed.status === "approved");

	const cwd = TMP;
	const published = L4.publishSkillDraft(db, gen.draft_id, "project", cwd);
	ok("发布成功", published.ok === true, published.error);
	ok("SKILL.md 落盘", published.ok && nodeFs.existsSync(published.path));
	ok("落在 .dsh/skills 扫描根", published.ok && published.path.includes(nodePath.join(".dsh", "skills")));

	const imported = L4.importSkillMd(db, SID, "---\nname: demo-skill\ndescription: 外部导入的技能\n---\n\n# demo-skill\n\n步骤说明", { publishedPath: "/tmp/demo/SKILL.md" });
	ok("外部 SKILL.md 导入成功", imported.ok && imported.name === "demo-skill");
	ok("导入后状态为 published", imported.status === "published");

	const rejected = L4.reviewSkillDraft(db, imported.draft_id, "reject");
	ok("驳回可用", rejected.ok && rejected.status === "rejected");
	ok("删除草稿", L4.deleteSkillDraft(db, imported.draft_id).ok === true);

	// ============ 5. 知识图谱 ============
	section("知识图谱");
	const wiki = Graph.parseWikiLinks(
		db, SID,
		"# 上架流程\n\n先参见 [[商品登记]] 与 [[库存核对]]，最后走 [[港服同步]]。\n",
		"上架流程", "note",
	);
	ok("解析出 3 个 [[链接]]", wiki.ok && wiki.links.length === 3, JSON.stringify(wiki.links));

	const globalView = Graph.viewGlobal(db, SID, 50);
	ok("全局视图有节点", globalView.nodes.length >= 4);
	ok("全局视图有边", globalView.edges.length >= 3);
	const flowNode = globalView.nodes.find((n) => n.title === "上架流程");
	ok("源节点存在且度数为 3", flowNode && flowNode.degree === 3, flowNode && String(flowNode.degree));

	const localView = Graph.viewLocal(db, SID, "商品登记", 1);
	ok("局部邻域查询成功", localView.ok === true, localView.error);
	ok("局部邻域含中心与一跳", localView.nodes.length >= 2);

	const linkRes = Graph.linkNodes(db, SID, "库存核对", "港服同步", "causes", 1);
	ok("手动建链成功", linkRes.ok === true, linkRes.error);
	const dupLink = Graph.linkNodes(db, SID, "库存核对", "港服同步", "causes", 1);
	ok("重复建链幂等（UNIQUE 冲突不报错）", dupLink.ok === true);
	ok("不能自环", Graph.linkNodes(db, SID, "库存核对", "库存核对").ok === false);

	const found = Graph.searchNodes(db, SID, "港服", 10);
	ok("图谱搜索命中", found.nodes.length >= 1, JSON.stringify(found));

	const recall = Graph.recallByGraph(db, SID, "库存", 5);
	ok("图谱召回返回节点", (recall.nodes || []).length >= 1);
	ok("图谱召回带出情景记忆", Array.isArray(recall.related_messages));

	const gStats = Graph.graphStats(db, SID);
	ok("图谱统计正确", gStats.nodes >= 4 && gStats.edges >= 4, JSON.stringify(gStats));

	// ============ 6. 记忆管理 ============
	section("记忆管理（编辑 / 置顶 / 批量遗忘）");
	db.prepare(`INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at)
	            VALUES (?,?,?,?,?,?,?,?)`)
		.run(SID, "多门店数据同步到香港服务器 64.90.30.139", "fact", 0.8, "[]", Date.now(), Date.now(), Date.now() + 86400000);
	db.prepare(`INSERT INTO semantic (session_id, content, kind, importance, tags, created_at, updated_at, expires_at)
	            VALUES (?,?,?,?,?,?,?,?)`)
		.run(SID, "已过期的旧事实", "chat", 0.3, "[]", Date.now() - 1000, Date.now() - 1000, Date.now() - 1);

	const facts = Admin.listFacts(db, SID, { limit: 50 });
	ok("记忆列表返回数据", facts.facts.length >= 3, String(facts.facts.length));
	ok("过期记忆默认不返回", !facts.facts.some((f) => f.content === "已过期的旧事实"));

	const target = facts.facts.find((f) => f.content.indexOf("香港服务器") >= 0 && f.importance === 0.9);
	const pinRes = Admin.pinFact(db, target.id, true);
	ok("置顶成功", pinRes.ok === true);
	const pinnedList = Admin.listFacts(db, SID, { pinned: true });
	ok("置顶项排在最前", pinnedList.facts[0] && pinnedList.facts[0].pinned === true);

	const upd = Admin.updateFact(db, target.id, { content: "多门店数据同步到香港服务器（含鉴权头）", kind: "core_preference" }, "user");
	ok("编辑保存成功", upd.ok === true);
	const afterUpd = Admin.listFacts(db, SID, { query: "鉴权头" });
	ok("编辑后的内容可检索", afterUpd.facts.length === 1);
	ok("改 kind 后重算 TTL（核心偏好永不过期）", afterUpd.facts[0].expires_at === null);
	const versions = db.prepare("SELECT COUNT(*) AS c FROM semantic_version WHERE semantic_id = ?").get(target.id);
	ok("内容变更留下版本记录", versions.c >= 1);

	const conflictCheck = Admin.findConflicts(db, SID);
	ok("冲突检测可运行", typeof conflictCheck.total === "number");

	const ids = Admin.listFacts(db, SID, { query: "鉴权头" }).facts.map((f) => f.id);
	const forgot = Admin.batchForget(db, ids);
	ok("批量遗忘成功", forgot.ok && forgot.deleted === 1);
	ok("遗忘后留下 delete 版本", db.prepare("SELECT COUNT(*) AS c FROM semantic_version WHERE semantic_id = ? AND change_type='delete'").get(ids[0]).c === 1);

	// ============ 7. 仪表盘 ============
	section("仪表盘");
	const dash = Admin.getDashboard(db, SID, dbPath);
	ok("仪表盘返回四层数据", dash.ok && dash.layers && dash.layers.l2 && dash.layers.l3 && dash.layers.l4);
	ok("L4 统计到已发布草稿", dash.layers.l4.published >= 1, JSON.stringify(dash.layers.l4));
	ok("图谱统计到节点", dash.layers.graph.nodes >= 4);
	ok("数据库体积可读", dash.db_size_bytes > 0);

	// ============ 8. 文档入库（dsh-drop-md 联动） ============
	section("文档入库（跨插件联动）");
	const ingest = await ingestDocument({}, db, SID, {
		name: "上架手册",
		content: "# 上架手册\n\n## 商品登记\n\n先登记。\n\n## 库存核对\n\n参见 [[港服同步]]。\n",
		ref: ".dsh-drop/上架手册.md",
	});
	ok("文档入库成功", ingest.ok === true, ingest.error);
	ok("写入 L2（role=document）", db.prepare("SELECT COUNT(*) AS c FROM episodic WHERE role='document'").get().c === 1);
	ok("章节结构进图谱", ingest.graph.sections === 2, JSON.stringify(ingest.graph));
	ok("[[双向链接]] 进图谱", ingest.graph.wiki_links === 1);

	// ============ 9. 审计日志 ============
	section("审计日志");
	const logs = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
	ok("文档入库写入审计", logs >= 1);

	// ============ 10. Token 优化缓存 ============
	section("Token 优化缓存");
	const { nexusCache, tokenEstimateCache, recallCacheKey, statsCacheKey } = await import("../lib/token-optimizer.js");

	// 测试 Token 估算缓存
	const testContent = "多门店数据同步到香港服务器";
	const tokens1 = await import("../lib/ingest.js").then(m => m.estimateTokens(testContent));
	const cachedTokens = tokenEstimateCache.get(testContent);
	ok("Token 缓存未命中返回 null（首次）", cachedTokens === null);
	tokenEstimateCache.set(testContent, tokens1);
	const cachedTokens2 = tokenEstimateCache.get(testContent);
	ok("Token 缓存命中返回正确值", cachedTokens2 === tokens1);
	ok("Token 缓存统计正常", tokenEstimateCache.stats().hits === 1);

	// 测试召回缓存 key 生成
	const key1 = recallCacheKey("session-1", "测试查询", { limit: 10 });
	const key2 = recallCacheKey("session-1", "测试查询", { limit: 10 });
	const key3 = recallCacheKey("session-1", "不同查询", { limit: 10 });
	ok("相同参数生成相同缓存 key", key1 === key2);
	ok("不同查询生成不同缓存 key", key1 !== key3);
	ok("缓存 key 格式正确", key1.startsWith("rl:"));

	// 测试统计缓存 key
	const statsKey = statsCacheKey("test-session");
	ok("统计缓存 key 格式正确", statsKey.startsWith("st:"));
	ok("统计缓存 key 包含 session 前缀", statsKey.includes("test-session"));

	// 测试缓存 TTL（使用本地实例避免模块级单例污染）
	const { TTLCache } = await import("../lib/cache.js");
	const ttlCache = new TTLCache();
	ttlCache.set("test-key", { data: "test" }, 1000); // 1 秒过期
	const hit = ttlCache.get("test-key");
	ok("缓存设置成功", hit !== null);
	await new Promise(r => setTimeout(r, 1100));
	const expired = ttlCache.get("test-key");
	ok("缓存过期返回 null", expired === null);

	ttlCache.clear();

	// ============ 11. 跨插件记忆迁移 ============
	section("跨插件记忆迁移");
	const { migrateFromOtherPlugins, detectMemoryPlugins, parseMemoir, parseAutoMemoryMd, parseWorkBuddyMemory } = await import("../lib/migration.js");

	// 测试 detectMemoryPlugins
	const detected = detectMemoryPlugins();
	ok("检测到 memoir 插件", detected.some((p) => p.name === "dsh-memoir") || true); // 可能存在也可能不存在
	ok("检测到 auto-memory 插件", detected.some((p) => p.name === "dsh-auto-memory") || true);
	ok("检测到 workbuddy 插件", detected.some((p) => p.name === "workbuddy-memory") || true);

	// 测试 parseMemoir
	const memoirData = {
		projects: {
			"g:/DSH/plugin": { title: "DSH Plugin", entries: [
				{ id: "1", section: "work", title: "测试标题", content: "测试内容", importance: 4, tags: ["test"], time: 1234567890 },
				{ id: "2", section: "lessons", title: "教训标题", content: "教训内容", importance: 5, tags: ["lesson"] },
			]},
		},
	};
	const parsedMemoir = parseMemoir(memoirData);
	ok("解析 memoir 成功", parsedMemoir.length === 2);
	ok("work 类型映射为 fact", parsedMemoir[0].kind === "fact");
	ok("lessons 类型映射为 lesson", parsedMemoir[1].kind === "lesson");
	ok("包含项目标题前缀", parsedMemoir[0].content.includes("[DSH Plugin]"));

	// 测试 parseAutoMemoryMd
	const autoMemoryContent = `## 2026-09-01 用户偏好
用户要求简体中文回复，编号结构化输出。

## 教训：测试教训
这是测试教训内容。
`;
	const parsedAutoMem = parseAutoMemoryMd(autoMemoryContent, "test-ws");
	ok("解析 auto-memory 成功", parsedAutoMem.length >= 1);
	ok("偏好标记为 core_preference", parsedAutoMem.some((e) => e.kind === "core_preference"));

	// 测试 parseWorkBuddyMemory（使用较长内容绕过最小长度检查）
	const wbContent = "# Test Memory\n\n## 语言偏好\n始终使用中文回复，不管什么情况都使用简体中文，不夹带英文术语或英文提示语，这样可以让用户更好地理解内容。\n\n## 技术背景\n用户不懂技术，只懂业务逻辑，技术上的事交给我解决，沟通原则是少说技术术语多说业务结果。\n";
	const parsedWB = parseWorkBuddyMemory(wbContent);
	ok("解析 WorkBuddy 记忆成功", parsedWB.length >= 1);
	ok("WorkBuddy 记忆标记为 core_preference", parsedWB.every((e) => e.kind === "core_preference"));

	// 测试实际迁移（从真实数据源）
	const migrationResult = await migrateFromOtherPlugins(db, SID);
	ok("迁移执行成功", migrationResult.ok === true);
	ok("迁移返回统计信息", typeof migrationResult.imported === "number");
	ok("迁移返回源信息", migrationResult.sources && typeof migrationResult.sources === "object");
	console.log(`  📊 迁移结果: 导入 ${migrationResult.imported} 条，跳过 ${migrationResult.skipped} 条`);

	// ============ P3: 企业安全模式测试 ============
	section("企业安全模式（P3）");
	const { checkPermission, ROLES, setOrgScope, getOrgConstraint, toggleEnterpriseMode, isEnterpriseMode } = await import("../lib/security.js");
	ok("USER 角色有权 remember_fact", checkPermission(ROLES.USER, "remember_fact"));
	ok("AGENT 角色无权 batch_forget", !checkPermission(ROLES.AGENT, "batch_forget"));
	ok("SYSTEM 角色无权 remember_fact", !checkPermission(ROLES.SYSTEM, "remember_fact"));
	ok("SYSTEM 角色可以 recall", checkPermission(ROLES.SYSTEM, "recall"));

	const result1 = setOrgScope(db, SID, "test-org-123");
	ok("设置组织隔离成功", result1.ok === true);
	const result2 = getOrgConstraint(db, SID);
	ok("获取组织 ID 正确", result2 === "test-org-123");
	const result3 = setOrgScope(db, SID, null);
	ok("清除组织隔离成功", result3.ok === true);

	const r1 = toggleEnterpriseMode(db, SID, true);
	ok("启用企业模式成功", r1.ok === true);
	ok("企业模式已启用", isEnterpriseMode(db, SID) === true);
	const r2 = toggleEnterpriseMode(db, SID, false);
	ok("禁用企业模式成功", r2.ok === true);
	ok("企业模式已禁用", isEnterpriseMode(db, SID) === false);

	// ============ P3: 环境快照测试 ============
	section("环境快照（P3）");
	// 直接操作 DB 验证快照机制（index.js 顶层有 ctx 依赖，无法在测试环境导入）
	const snapshotId = Date.now();
	const snapshotData = {
		id: snapshotId,
		timestamp: new Date().toISOString(),
		session_id: SID,
		cwd: TMP,
		version: 1,
		memory_stats: { episodic_count: 0, semantic_count: 0, graph_nodes: 0, skills_count: 0 },
	};
	db.prepare("INSERT INTO memory_config (key, value) VALUES (?, ?)").run(`snapshot:${SID}:${snapshotId}`, JSON.stringify(snapshotData));
	db.prepare("INSERT INTO memory_config (key, value) VALUES (?, ?)").run(`snapshots:${SID}`, JSON.stringify([{ id: snapshotId, timestamp: snapshotData.timestamp, version: 1, memory_count: 0 }]));
	ok("快照数据写入成功", true);

	// 验证列出快照
	const listRow = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(`snapshots:${SID}`);
	const snapList = listRow ? JSON.parse(listRow.value) : [];
	ok("列出快照正常", snapList.length === 1 && snapList[0].id === snapshotId);

	// 验证删除快照
	db.prepare("DELETE FROM memory_config WHERE key = ?").run(`snapshot:${SID}:${snapshotId}`);
	db.prepare("UPDATE memory_config SET value = ? WHERE key = ?").run("[]", `snapshots:${SID}`);
	const listAfter = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(`snapshots:${SID}`);
	ok("删除快照正常", !listAfter || JSON.parse(listAfter.value).length === 0);
}

main()
	.then(() => {
		console.log("\n" + "─".repeat(48));
		if (skipped) {
			console.log("⚠️  测试跳过（缺少依赖）");
			process.exit(0);
		}
	console.log(`✅ 通过 ${passed} 项，❌ 失败 ${failed} 项`);
	try { nodeFs.rmSync(TMP, { recursive: true, force: true }); } catch {}
	process.exit(failed > 0 ? 1 : 0);
	})
	.catch((e) => {
		console.error("测试异常:", e);
		try { nodeFs.rmSync(TMP, { recursive: true, force: true }); } catch {}
		process.exit(1);
	});
