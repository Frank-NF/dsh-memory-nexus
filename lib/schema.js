// dsh-memory-nexus — 数据库 schema 与初始化
//
// 集中管理建表语句，host half 与测试共用同一份结构，避免两边漂移。
// 升级策略：所有表用 CREATE TABLE IF NOT EXISTS，新增列用 ensureColumn 补齐。

import nodeFs from "node:fs";

// 初始化数据库（建表）
export function initDatabase(dbPath, Sqlite) {
	if (!Sqlite) return null;

	// 打开（或创建）数据库。无论新旧库都跑一次 schema 校验，保证升级后表结构补齐
	let existed = false;
	try {
		existed = nodeFs.existsSync(dbPath);
	} catch {}
	const db = new Sqlite(dbPath);

	// 执行建表 SQL
	db.exec(`
		CREATE TABLE IF NOT EXISTS episodic (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			token_count INTEGER DEFAULT 0,
			metadata TEXT
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
			content,
			content_rowid=id,
			tokenize='trigram'
		);

		CREATE TRIGGER IF NOT EXISTS episodic_ai AFTER INSERT ON episodic BEGIN
			INSERT INTO episodic_fts(rowid, content) VALUES (new.id, new.content);
		END;

		CREATE TRIGGER IF NOT EXISTS episodic_ad AFTER DELETE ON episodic BEGIN
			DELETE FROM episodic_fts WHERE rowid = old.id;
		END;

		CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic(session_id);
		CREATE INDEX IF NOT EXISTS idx_episodic_timestamp ON episodic(timestamp);

		CREATE TABLE IF NOT EXISTS snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			before_state TEXT NOT NULL,
			after_state TEXT,
			description TEXT
		);

		CREATE TABLE IF NOT EXISTS memory_config (
			key TEXT PRIMARY KEY,
			value TEXT
		);

		-- L3 语义记忆表
		CREATE TABLE IF NOT EXISTS semantic (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			content TEXT NOT NULL,
			kind TEXT DEFAULT 'fact',
			importance REAL DEFAULT 0.5,
			tags TEXT DEFAULT '[]',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			expires_at INTEGER,
			version INTEGER DEFAULT 1
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts USING fts5(
			content,
			content_rowid=id,
			tokenize='trigram'
		);

		CREATE TRIGGER IF NOT EXISTS semantic_ai AFTER INSERT ON semantic BEGIN
			INSERT INTO semantic_fts(rowid, content) VALUES (new.id, new.content);
		END;

		CREATE TRIGGER IF NOT EXISTS semantic_ad AFTER DELETE ON semantic BEGIN
			DELETE FROM semantic_fts WHERE rowid = old.id;
		END;

		CREATE INDEX IF NOT EXISTS idx_semantic_session ON semantic(session_id);
		CREATE INDEX IF NOT EXISTS idx_semantic_kind ON semantic(kind);
		CREATE INDEX IF NOT EXISTS idx_semantic_expires ON semantic(expires_at);

		-- 语义记忆版本链
		CREATE TABLE IF NOT EXISTS semantic_version (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			semantic_id INTEGER NOT NULL,
			version INTEGER NOT NULL,
			content TEXT NOT NULL,
			change_type TEXT DEFAULT 'update',
			changed_at INTEGER NOT NULL,
			FOREIGN KEY (semantic_id) REFERENCES semantic(id)
		);

		CREATE INDEX IF NOT EXISTS idx_semantic_version_semantic ON semantic_version(semantic_id);

		-- ============ P2: L4 程序记忆（Skill 草稿） ============
		CREATE TABLE IF NOT EXISTS skill_draft (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT NOT NULL,
			when_to_use TEXT DEFAULT '',
			content TEXT NOT NULL,
			source TEXT DEFAULT 'generated',
			status TEXT DEFAULT 'draft',
			review_note TEXT DEFAULT '',
			published_path TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			reviewed_at INTEGER
		);

		CREATE INDEX IF NOT EXISTS idx_skill_draft_session ON skill_draft(session_id);
		CREATE INDEX IF NOT EXISTS idx_skill_draft_status ON skill_draft(status);

		-- ============ P2: 知识图谱 ============
		CREATE TABLE IF NOT EXISTS graph_node (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			title TEXT NOT NULL,
			content TEXT DEFAULT '',
			node_type TEXT DEFAULT 'concept',
			weight REAL DEFAULT 1,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(session_id, title)
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS graph_node_fts USING fts5(
			title, content,
			content_rowid=id,
			tokenize='trigram'
		);

		CREATE TRIGGER IF NOT EXISTS graph_node_ai AFTER INSERT ON graph_node BEGIN
			INSERT INTO graph_node_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
		END;

		CREATE TRIGGER IF NOT EXISTS graph_node_ad AFTER DELETE ON graph_node BEGIN
			DELETE FROM graph_node_fts WHERE rowid = old.id;
		END;

		CREATE TABLE IF NOT EXISTS graph_edge (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			source_id INTEGER NOT NULL,
			target_id INTEGER NOT NULL,
			relation TEXT DEFAULT 'related',
			weight REAL DEFAULT 1,
			created_at INTEGER NOT NULL,
			UNIQUE(source_id, target_id, relation),
			FOREIGN KEY (source_id) REFERENCES graph_node(id),
			FOREIGN KEY (target_id) REFERENCES graph_node(id)
		);

		CREATE INDEX IF NOT EXISTS idx_graph_edge_source ON graph_edge(source_id);
		CREATE INDEX IF NOT EXISTS idx_graph_edge_target ON graph_edge(target_id);

		-- ============ P2: 审计日志 ============
		CREATE TABLE IF NOT EXISTS audit_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT,
			actor TEXT DEFAULT 'agent',
			action TEXT NOT NULL,
			target_type TEXT,
			target_id TEXT,
			detail TEXT,
			created_at INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
		CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
	`);

	ensureColumn(db, "semantic", "pinned", "INTEGER DEFAULT 0");
	ensureColumn(db, "semantic", "source", "TEXT DEFAULT 'agent'");
	ensureColumn(db, "episodic", "pinned", "INTEGER DEFAULT 0");

	if (existed) {
		try { db.exec("INSERT OR IGNORE INTO memory_config(key, value) VALUES('schema_version', '2')"); } catch {}
	} else {
		try { db.exec("INSERT OR IGNORE INTO memory_config(key, value) VALUES('schema_version', '2')"); } catch {}
	}

	return db;
}

// 旧库升级：缺列则补（SQLite 不支持 ADD COLUMN IF NOT EXISTS）
export function ensureColumn(db, table, column, definition) {
	try {
		const cols = db.prepare("PRAGMA table_info(" + table + ")").all();
		if (cols.some((c) => c.name === column)) return;
		db.exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
	} catch {}
}
