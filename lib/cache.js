// dsh-memory-nexus — 轻量 TTL 内存缓存
//
// 用于：召回结果缓存、统计缓存、已估算 token 去重缓存。
// 所有函数同步（better-sqlite3 风格），无外部依赖。

const DEFAULT_TTL_MS = 30_000; // 默认 30 秒过期
const MAX_SIZE = 500;           // 最多条目，防内存泄漏

/**
 * CacheEntry { data, expireAt }
 */

export class TTLCache {
	constructor(options = {}) {
		this._store = new Map();
		this._defaultTtl = options.defaultTtl ?? DEFAULT_TTL_MS;
		this._maxSize = options.maxSize ?? MAX_SIZE;
		// 命中/未命中计数
		this.hits = 0;
		this.misses = 0;
	}

	/** 获取缓存 key 的有效 TTL（毫秒），未到则 null */
	_getTtl(key, ttlMs) {
		return ttlMs !== undefined ? ttlMs : this._defaultTtl;
	}

	/** 删除条目，返回是否成功 */
	del(key) {
		const ok = this._store.delete(key);
		if (ok) this.misses += 1; // 显式删除不计入命中
		return ok;
	}

	/** 获取缓存值，命中返回 { data, remainingMs }，否则 null */
	get(key) {
		const entry = this._store.get(key);
		if (!entry) return null;
		if (Date.now() > entry.expireAt) {
			this._store.delete(key);
			this.misses += 1;
			return null;
		}
		this.hits += 1;
		const remainingMs = entry.expireAt - Date.now();
		return { data: entry.data, remainingMs };
	}

	/** 设置缓存，容量满时驱逐最旧条目 */
	set(key, data, ttlMs) {
		// 容量满：驱逐最旧的一半（简单策略）
		if (this._store.size >= this._maxSize) {
			const keys = Array.from(this._store.keys());
			for (let i = 0; i < Math.floor(keys.length / 2); i++) {
				this._store.delete(keys[i]);
			}
		}
		this._store.set(key, {
			data,
			expireAt: Date.now() + this._getTtl(key, ttlMs),
		});
	}

	/** 清空所有条目 */
	clear() {
		this._store.clear();
		this.hits = 0;
		this.misses = 0;
	}

	/** 清理过期条目 */
	prune() {
		const now = Date.now();
		for (const [key, entry] of this._store) {
			if (now > entry.expireAt) this._store.delete(key);
		}
	}

	/** 获取缓存统计 */
	stats() {
		this.prune();
		const total = this.hits + this.misses;
		return {
			size: this._store.size,
			hits: this.hits,
			misses: this.misses,
			hit_rate: total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0,
		};
	}
}

/** 单例实例，供各模块共享 */
export const nexusCache = new TTLCache({ defaultTtl: DEFAULT_TTL_MS, maxSize: MAX_SIZE });
