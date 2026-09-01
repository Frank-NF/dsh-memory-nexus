// dsh-memory-nexus — Token 优化器
//
// 功能：
//   1. 字符串简单哈希（FNV-1a，足够区分不同内容，不依赖 crypto 模块）
//   2. 内容指纹缓存：相同内容复用已有 token 估算，避免重复调用 estimateTokens
//
// FNV-1a 32bit 实现（纯 JS，无依赖）
// 参考：https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function

const FNV_OFFSET = 2166136261;
const FNV_PRIME  = 16777619;
const MOD = 0x100000000; // 2^32

/** 快速字符串哈希（32bit 整数，转为 8 位十六进制） */
export function fnv1a32(str) {
	let h = FNV_OFFSET >>> 0;
	const len = str.length;
	for (let i = 0; i < len; i++) {
		h ^= str.charCodeAt(i);
		h = (h * FNV_PRIME) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/**
 * 生成召回缓存的 key：sessionId + query 前缀 + options 关键项
 * 格式：rl:<sessionId>:<qPrefix>:<optHash>
 */
export function recallCacheKey(sessionId, query, options) {
	const qPrefix = String(query || "").slice(0, 60);
	const optHash = fnv1a32(JSON.stringify({
		limit: options?.limit,
		memory_max_token: options?.memory_max_token,
		include_skills: options?.include_skills,
		include_graph: options?.include_graph,
		graph_limit: options?.graph_limit,
	}));
	return "rl:" + String(sessionId || "").slice(0, 32) + ":" + qPrefix + ":" + optHash;
}

/**
 * 生成构建 Prompt 缓存的 key：sessionId + query + options
 * 格式：bp:<sessionId>:<qPrefix>:<optHash>
 */
export function buildPromptCacheKey(sessionId, query, options) {
	const qPrefix = String(query || "").slice(0, 60);
	const optHash = fnv1a32(JSON.stringify({
		memory_max_token: options?.memory_max_token,
		enable_structured_prompt: options?.enable_structured_prompt,
		omit_memory_tip: options?.omit_memory_tip,
	}));
	return "bp:" + String(sessionId || "").slice(0, 32) + ":" + qPrefix + ":" + optHash;
}

/**
 * 生成统计缓存 key
 * 格式：st:<sessionId>
 */
export function statsCacheKey(sessionId) {
	return "st:" + String(sessionId || "").slice(0, 32);
}

/**
 * Token 估算缓存：key = contentHash，value = { tokens, content }
 * 命中时直接返回 cached.tokens，避免重复计算 estimateTokens
 */
export class TokenEstimateCache {
	constructor(maxSize = 200) {
		this._store = new Map();
		this._maxSize = maxSize;
		this.hits = 0;
		this.misses = 0;
	}

	get(content) {
		if (!content) return null;
		const hash = fnv1a32(content);
		const entry = this._store.get(hash);
		if (!entry) return null;
		// 内容一致才命中（防碰撞）
		if (entry.content === content) {
			this.hits += 1;
			return entry.tokens;
		}
		// 碰撞：覆盖
		this.misses += 1;
		return null;
	}

	set(content, tokens) {
		if (this._store.size >= this._maxSize) {
			const firstKey = this._store.keys().next().value;
			this._store.delete(firstKey);
		}
		const hash = fnv1a32(content);
		this._store.set(hash, { content, tokens });
	}

	/** 清空所有条目 */
	clear() {
		this._store.clear();
		this.hits = 0;
		this.misses = 0;
	}

	/** 获取缓存统计 */
	stats() {
		const total = this.hits + this.misses;
		return {
			size: this._store.size,
			hits: this.hits,
			misses: this.misses,
			hit_rate: total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0,
		};
	}
}

/** 单例实例 */
export const tokenEstimateCache = new TokenEstimateCache();
