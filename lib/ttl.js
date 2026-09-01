// dsh-memory-nexus — 记忆 TTL 规则（L3 语义记忆衰减策略）
//
// 四类语义记忆的存活时间：聊天碎片最短，核心偏好永不衰减。

export const TTL_RULES = {
	chat: 7 * 24 * 60 * 60 * 1000, // 7 天
	fact: 30 * 24 * 60 * 60 * 1000, // 30 天
	core_preference: null, // 永不过期
	lesson: 90 * 24 * 60 * 60 * 1000, // 90 天
};

export const MEMORY_KINDS = ["fact", "core_preference", "lesson", "chat"];

// 返回过期时间戳（毫秒）；null 表示永不过期
export function calculateTTLSeconds(kind, now = Date.now()) {
	const ttl = Object.prototype.hasOwnProperty.call(TTL_RULES, kind) ? TTL_RULES[kind] : TTL_RULES.fact;
	return ttl ? now + ttl : null;
}

// 是否永不过期
export function isPermanent(kind) {
	return Object.prototype.hasOwnProperty.call(TTL_RULES, kind) && TTL_RULES[kind] === null;
}
