// dsh-memory-nexus — client half (browser bundle for the dsh module loader).
// Protocol (mirrors @deepseek-ai client bundles): the loader answers
// require("react") from the platform module table; everything else is
// self-contained. Exports a Cordis plugin (function with static
// .inject/.apply, same shape as @changfenhuang/dsh-genui).

window.__ModuleLoader__.load({
	id: "dsh-memory-nexus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		const PACKAGE_ID = "dsh-memory-nexus";
		const API_ROUTE = "/api/memory-nexus";

		function injectStyle(css) {
			if (typeof document === "undefined") return;
			const tagId = PACKAGE_ID + "/client.css";
			if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = PACKAGE_ID;
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		injectStyle([
			// 按钮容器
			'.ds-mnexus-btn-wrap{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;cursor:pointer;transition:all .15s ease;position:relative;}',
			'.ds-mnexus-btn-wrap:hover{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.06));}',
			'.ds-mnexus-btn-wrap:disabled{opacity:.4;cursor:not-allowed;}',
			'.ds-mnexus-btn-wrap:disabled:hover{background:transparent;}',
			// 状态颜色
			'.ds-mnexus-btn-normal{color:var(--dsw-alias-label-secondary);}',
			'.ds-mnexus-btn-warn{color:#f59e0b;animation:ds-mnexus-pulse 1.5s ease-in-out infinite;}',
			'.ds-mnexus-btn-danger{color:#ef4444;animation:ds-mnexus-pulse 1s ease-in-out infinite;}',
			'@keyframes ds-mnexus-pulse{0%,100%{opacity:1;}50%{opacity:.6;}}',
			// 下拉菜单
			'.ds-mnexus-dropdown{position:absolute;bottom:calc(100% + 8px);left:0;min-width:240px;background:var(--dsw-alias-bg-overlay,#1b1e27);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));border-radius:12px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);z-index:10000;animation:ds-mnexus-fade-in .15s ease-out;}',
			'@keyframes ds-mnexus-fade-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}',
			'.ds-mnexus-dropdown-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary);transition:background .12s ease;}',
			'.ds-mnexus-dropdown-item:hover{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.06));}',
			'.ds-mnexus-dropdown-item:disabled{opacity:.4;cursor:not-allowed;}',
			'.ds-mnexus-dropdown-item:disabled:hover{background:transparent;}',
			'.ds-mnexus-dropdown-icon{font-size:16px;line-height:1;flex:none;}',
			'.ds-mnexus-dropdown-text{flex:1;min-width:0;}',
			'.ds-mnexus-dropdown-shortcut{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none;}',
			// 标记点
			'.ds-mnexus-badge{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4f8ef7);}',
			'.ds-mnexus-badge.warn{background:#f59e0b;}',
			'.ds-mnexus-badge.danger{background:#ef4444;}',
			// ===== P2 记忆面板 =====
			'.ds-mnexus-scrim{position:fixed;inset:0;z-index:11000;background:rgba(0,0,0,.45);animation:ds-mnexus-fade-in .15s ease-out;}',
			'.ds-mnexus-panel{position:fixed;z-index:11001;top:6vh;left:50%;transform:translateX(-50%);width:min(860px,calc(100vw - 48px));height:80vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#1b1e27);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.28);overflow:hidden;animation:ds-mnexus-pop .18s ease-out;}',
			'@keyframes ds-mnexus-pop{from{opacity:0;transform:translateX(-50%) scale(.98);}to{opacity:1;transform:translateX(-50%) scale(1);}}',
			'.ds-mnexus-panel-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));flex:none;}',
			'.ds-mnexus-panel-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1;}',
			'.ds-mnexus-panel-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;cursor:pointer;width:26px;height:26px;border-radius:6px;}',
			'.ds-mnexus-panel-close:hover{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary);}',
			'.ds-mnexus-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));flex:none;overflow-x:auto;}',
			'.ds-mnexus-tab{padding:6px 14px;border-radius:8px;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-secondary);white-space:nowrap;transition:background .12s ease,color .12s ease;}',
			'.ds-mnexus-tab:hover{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.06));}',
			'.ds-mnexus-tab.active{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary);font-weight:600;}',
			'.ds-mnexus-body{flex:1;overflow-y:auto;padding:16px 18px;}',
			'.ds-mnexus-foot{flex:none;padding:10px 18px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:10px;}',
			'.ds-mnexus-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px;}',
			'.ds-mnexus-card{padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));}',
			'.ds-mnexus-card-label{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;}',
			'.ds-mnexus-card-value{font-size:20px;font-weight:600;color:var(--dsw-alias-label-primary);margin-top:4px;}',
			'.ds-mnexus-card-sub{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;}',
			'.ds-mnexus-section-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:16px 0 8px;display:flex;align-items:center;gap:8px;}',
			'.ds-mnexus-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}',
			'.ds-mnexus-input{flex:1;min-width:140px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary);font-size:13px;outline:none;}',
			'.ds-mnexus-input:focus{border-color:var(--dsw-alias-brand-primary,#4f8ef7);}',
			'.ds-mnexus-select{padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary);font-size:13px;}',
			'.ds-mnexus-btn{padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary);transition:filter .12s ease,opacity .12s ease;}',
			'.ds-mnexus-btn:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.2));}',
			'.ds-mnexus-btn:disabled{opacity:.5;cursor:default;}',
			'.ds-mnexus-btn.primary{background:var(--dsw-alias-brand-primary,#4f8ef7);color:#fff;border-color:transparent;}',
			'.ds-mnexus-btn.ok{color:#16a34a;border-color:#16a34a;}',
			'.ds-mnexus-btn.warnc{color:#f59e0b;border-color:#f59e0b;}',
			'.ds-mnexus-btn.danger{color:#ef4444;border-color:#ef4444;}',
			'.ds-mnexus-row{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));margin-bottom:8px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));}',
			'.ds-mnexus-row.pinned{border-color:var(--dsw-alias-brand-primary,#4f8ef7);}',
			'.ds-mnexus-row-main{flex:1;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary);word-break:break-word;line-height:1.55;}',
			'.ds-mnexus-row-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;display:flex;flex-wrap:wrap;gap:8px;}',
			'.ds-mnexus-tag{font-size:10px;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));color:var(--dsw-alias-label-secondary);}',
			'.ds-mnexus-tag.kind{color:var(--dsw-alias-brand-primary,#4f8ef7);}',
			'.ds-mnexus-actions{display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end;}',
			'.ds-mnexus-textarea{width:100%;min-height:64px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-brand-primary,#4f8ef7);background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary);font-size:13px;resize:vertical;outline:none;font-family:inherit;}',
			'.ds-mnexus-empty{text-align:center;padding:32px 16px;color:var(--dsw-alias-label-secondary);font-size:13px;}',
			'.ds-mnexus-graph-box{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));overflow:hidden;}',
			'.ds-mnexus-graph-node{cursor:pointer;}',
			'.ds-mnexus-graph-label{font-size:9px;fill:var(--dsw-alias-label-secondary);pointer-events:none;}',
			'.ds-mnexus-log{display:flex;gap:10px;font-size:12px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary);}',
			'.ds-mnexus-log-time{color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums;}',
			'.ds-mnexus-log-actor{flex:none;padding:0 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));font-size:11px;}',
			'.ds-mnexus-spin{width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));border-top-color:var(--dsw-alias-brand-primary,#4f8ef7);border-radius:50%;animation:ds-mnexus-rot .8s linear infinite;display:inline-block;}',
			'@keyframes ds-mnexus-rot{to{transform:rotate(360deg);}}',
		].join("\n"));

		// API 调用
		function api(action, payload) {
			return fetch(API_ROUTE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(Object.assign({ action: action }, payload || {})),
			}).then((res) => res.json()).catch((e) => ({ ok: false, error: (e && e.message) || "network-error" }));
		}

		// 压缩按钮组件
		function CompressButton(props) {
			const sessionId = props.sessionId;
			const cwd = props.cwd;
			const [dropdownOpen, setDropdownOpen] = React.useState(false);
			const [tokenUsage, setTokenUsage] = React.useState(0);
			const [busy, setBusy] = React.useState(false);

			// 获取 token 使用情况
			React.useEffect(() => {
				if (!sessionId) return;
				api("stats", { sessionId }).then((res) => {
					if (res && res.ok && res.usage_percent !== undefined) {
						setTokenUsage(res.usage_percent);
					}
				});
			}, [sessionId]);

			// 点击外部关闭下拉
			React.useEffect(() => {
				const handleClickOutside = (e) => {
					if (dropdownOpen && !e.target.closest(".ds-mnexus-dropdown-wrap")) {
						setDropdownOpen(false);
					}
				};
				document.addEventListener("mousedown", handleClickOutside);
				return () => document.removeEventListener("mousedown", handleClickOutside);
			}, [dropdownOpen]);

			const handleAction = async (action, description) => {
				setBusy(true);
				setDropdownOpen(false);
				try {
					const res = await api(action, { sessionId, description });
					if (res && res.ok) {
						const stats = await api("stats", { sessionId });
						if (stats && stats.ok) {
							setTokenUsage(stats.usage_percent);
						}
						if (res.export_path) {
							console.log("[memory-nexus] 文件已导出:", res.export_path);
						}
						if (res.draft_id) {
							console.log("[memory-nexus] Skill 草稿已生成:", res.name, "（打开 🧠 记忆面板审核发布）");
						}
					} else {
						console.error("[memory-nexus]", action, "failed:", res?.error);
					}
				} catch (e) {
					console.error("[memory-nexus]", action, "error:", e);
				}
				setBusy(false);
			};

			// 根据 token 使用率决定状态
			let btnClass = "ds-mnexus-btn-normal";
			let badgeClass = null;
			if (tokenUsage >= 95) {
				btnClass = "ds-mnexus-btn-danger";
				badgeClass = "danger";
			} else if (tokenUsage >= 75) {
				btnClass = "ds-mnexus-btn-warn";
				badgeClass = "warn";
			}

			const dropdownItems = [
				{ icon: "🗜️", text: "智能压缩", action: "compress", shortcut: "保留最近N轮，历史摘要" },
				{ icon: "📝", text: "生成会话Skill草稿", action: "skill_generate", shortcut: "沉淀为 L4 技能" },
				{ icon: "🧹", text: "裁剪旧消息", action: "trim", shortcut: "保留最近N轮" },
				{ icon: "📌", text: "冻结历史", action: "freeze", shortcut: "导出归档md" },
				{ icon: "♻️", text: "重置会话", action: "reset", shortcut: "保留系统提示词" },
				{ icon: "📊", text: "上下文诊断报告", action: "stats", shortcut: "查看详情" },
			];

			return React.createElement("div", { className: "ds-mnexus-dropdown-wrap", style: { position: "relative" } },
				React.createElement("div", {
					className: "ds-mnexus-btn-wrap " + btnClass,
					disabled: !sessionId || busy,
					onClick: (e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen); },
					title: "上下文工具（压缩/冻结/诊断）",
				},
					"🗜️",
					badgeClass ? React.createElement("span", { className: "ds-mnexus-badge " + badgeClass }) : null
				),
				dropdownOpen ? React.createElement("div", { className: "ds-mnexus-dropdown" },
					dropdownItems.map((item, idx) => React.createElement("div", {
						key: idx,
						className: "ds-mnexus-dropdown-item",
						disabled: !item.action || busy,
						onClick: () => item.action && handleAction(item.action, item.text),
					},
						React.createElement("span", { className: "ds-mnexus-dropdown-icon" }, item.icon),
						React.createElement("span", { className: "ds-mnexus-dropdown-text" }, item.text),
						React.createElement("span", { className: "ds-mnexus-dropdown-shortcut" }, item.shortcut)
					))
				) : null
			);
		}

		// 增强提示词按钮组件
		function EnhancePromptButton(props) {
			const sessionId = props.sessionId;
			const [dropdownOpen, setDropdownOpen] = React.useState(false);
			const [memoryInjected, setMemoryInjected] = React.useState(false);
			const [memoryOverBudget, setMemoryOverBudget] = React.useState(false);
			const [recallData, setRecallData] = React.useState(null);
			const [busy, setBusy] = React.useState(false);

			React.useEffect(() => {
				const handleClickOutside = (e) => {
					if (dropdownOpen && !e.target.closest(".ds-mnexus-enhance-wrap")) {
						setDropdownOpen(false);
					}
				};
				document.addEventListener("mousedown", handleClickOutside);
				return () => document.removeEventListener("mousedown", handleClickOutside);
			}, [dropdownOpen]);

			const handleAction = async (action) => {
				setBusy(true);
				setDropdownOpen(false);
				try {
					if (action === "recall") {
						const res = await api("recall_for_prompt", { sessionId, limit: 10 });
						if (res && res.ok) {
							setRecallData(res);
							setMemoryInjected(res.total > 0);
							setMemoryOverBudget(res.omitted > 0);
						}
					} else if (action === "stats") {
						const res = await api("stats", { sessionId });
						if (res && res.ok) {
							setMemoryInjected(res.semantic?.active_facts > 0 || res.episodic?.total_messages > 0);
						}
					}
					console.log("[memory-nexus] enhance action:", action);
				} catch (e) {
					console.error("[memory-nexus]", action, "error:", e);
				}
				setBusy(false);
			};

			let btnClass = "ds-mnexus-btn-normal";
			let badgeClass = null;
			if (memoryOverBudget) {
				btnClass = "ds-mnexus-btn-warn";
				badgeClass = "warn";
			} else if (memoryInjected) {
				badgeClass = null;
			}

			const dropdownItems = [
				{ icon: "🧠", text: "查看当前召回记忆片段", action: "recall" },
				{ icon: "⚙️", text: "记忆&提示词配置", action: "config" },
				{ icon: "📋", text: "预览最终送入模型完整Prompt", action: "preview" },
				{ icon: "📥", text: "手动触发记忆整理", action: "sleep" },
				{ icon: "📊", text: "记忆数据库状态面板", action: "stats" },
			];

			return React.createElement("div", { className: "ds-mnexus-enhance-wrap", style: { position: "relative" } },
				React.createElement("div", {
					className: "ds-mnexus-btn-wrap " + btnClass,
					disabled: !sessionId || busy,
					onClick: (e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen); },
					title: "记忆&提示词编排工具",
				},
					"✨",
					badgeClass ? React.createElement("span", { className: "ds-mnexus-badge " + badgeClass }) : memoryInjected ? React.createElement("span", { className: "ds-mnexus-badge" }) : null
				),
				dropdownOpen ? React.createElement("div", { className: "ds-mnexus-dropdown" },
					dropdownItems.map((item, idx) => React.createElement("div", {
						key: idx,
						className: "ds-mnexus-dropdown-item",
						disabled: busy,
						onClick: () => handleAction(item.action),
					},
						React.createElement("span", { className: "ds-mnexus-dropdown-icon" }, item.icon),
						React.createElement("span", { className: "ds-mnexus-dropdown-text" }, item.text)
					))
				) : null,
				recallData ? React.createElement("div", {
					className: "ds-mnexus-recall-panel",
					style: {
						marginTop: "8px",
						padding: "12px",
						background: "var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04))",
						border: "1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12))",
						borderRadius: "8px",
						fontSize: "12px",
						maxHeight: "200px",
						overflowY: "auto",
					}
				},
					React.createElement("div", { style: { marginBottom: "8px", color: "var(--dsw-alias-label-secondary)" } },
						`已召回 ${recallData.total} 条记忆，使用 ${recallData.memory_tokens} tokens`
						+ (recallData.omitted > 0 ? `，省略 ${recallData.omitted} 条` : "")
					),
					recallData.memories.slice(0, 5).map((m, i) =>
						React.createElement("div", {
							key: i,
							style: {
								padding: "6px 0",
								borderBottom: i < 4 ? "1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1))" : "none",
								color: m.type === "semantic" ? "var(--dsw-alias-brand-primary,#4f8ef7)" : "var(--dsw-alias-label-primary)"
							}
						},
							React.createElement("span", { style: { fontWeight: 600, marginRight: "8px" } },
								m.type === "semantic" ? `[记忆:${m.kind}]` : `[对话:${m.role}]`
							),
							m.content.slice(0, 80) + (m.content.length > 80 ? "..." : "")
						)
					),
					recallData.memories.length > 5 ? React.createElement("div", {
						style: { color: "var(--dsw-alias-label-secondary)", textAlign: "center", padding: "8px" }
					}, `还有 ${recallData.memories.length - 5} 条记忆...`) : null
				) : null
			);
		}

		// ============ P2: 记忆可视化面板 ============

		const h = React.createElement;

		const TABS = [
			{ key: "overview", label: "📊 概览" },
			{ key: "facts", label: "🧠 语义记忆" },
			{ key: "skills", label: "🧩 技能草稿" },
			{ key: "graph", label: "🕸️ 知识图谱" },
			{ key: "audit", label: "📜 审计日志" },
		];

		const KIND_LABEL = {
			fact: "事实",
			core_preference: "核心偏好",
			lesson: "教训",
			chat: "聊天碎片",
		};

		function fmtSize(bytes) {
			if (!bytes) return "0 B";
			const units = ["B", "KB", "MB", "GB"];
			let i = 0, v = bytes;
			while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
			return (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
		}

		function fmtTime(ts) {
			if (!ts) return "-";
			const d = new Date(ts);
			const p = (n) => String(n).padStart(2, "0");
			return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}

		// 简化力导向布局（Fruchterman-Reingold），节点数控制在百级以内
		function layoutGraph(nodes, edges, width, height) {
			const n = nodes.length;
			if (n === 0) return [];
			const idx = new Map();
			nodes.forEach((node, i) => idx.set(node.id, i));
			const pos = nodes.map((node, i) => {
				const a = (i / Math.max(n, 1)) * Math.PI * 2;
				return {
					x: width / 2 + Math.cos(a) * width * 0.28 + (Math.random() - 0.5) * 20,
					y: height / 2 + Math.sin(a) * height * 0.28 + (Math.random() - 0.5) * 20,
					vx: 0, vy: 0,
				};
			});
			const k = Math.sqrt((width * height) / Math.max(n, 1)) * 0.55;
			const iterations = n > 60 ? 90 : 160;
			for (let it = 0; it < iterations; it += 1) {
				const temp = Math.max(2, 40 * (1 - it / iterations));
				for (let i = 0; i < n; i += 1) {
					for (let j = i + 1; j < n; j += 1) {
						let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
						let d2 = dx * dx + dy * dy;
						if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
						const d = Math.sqrt(d2);
						const f = (k * k) / d2;
						pos[i].vx += (dx / d) * f; pos[i].vy += (dy / d) * f;
						pos[j].vx -= (dx / d) * f; pos[j].vy -= (dy / d) * f;
					}
				}
				for (const e of edges) {
					const i = idx.get(e.source), j = idx.get(e.target);
					if (i === undefined || j === undefined) continue;
					const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
					const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
					const f = ((d * d) / k) * 0.02;
					pos[i].vx -= (dx / d) * f; pos[i].vy -= (dy / d) * f;
					pos[j].vx += (dx / d) * f; pos[j].vy += (dy / d) * f;
				}
				for (let i = 0; i < n; i += 1) {
					pos[i].vx += (width / 2 - pos[i].x) * 0.012;
					pos[i].vy += (height / 2 - pos[i].y) * 0.012;
					const disp = Math.max(Math.sqrt(pos[i].vx * pos[i].vx + pos[i].vy * pos[i].vy), 0.0001);
					const step = Math.min(disp, temp);
					pos[i].x += (pos[i].vx / disp) * step;
					pos[i].y += (pos[i].vy / disp) * step;
					pos[i].vx = 0; pos[i].vy = 0;
					const pad = 26;
					pos[i].x = Math.max(pad, Math.min(width - pad, pos[i].x));
					pos[i].y = Math.max(pad, Math.min(height - pad - 8, pos[i].y));
				}
			}
			return pos;
		}

		function GraphCanvas(props) {
			const nodes = props.nodes || [];
			const edges = props.edges || [];
			const W = 560, H = 340;
			const pos = React.useMemo(() => layoutGraph(nodes, edges, W, H), [nodes, edges]);
			const deg = {};
			for (const e of edges) {
				deg[e.source] = (deg[e.source] || 0) + 1;
				deg[e.target] = (deg[e.target] || 0) + 1;
			}
			if (nodes.length === 0) {
				return h("div", { className: "ds-mnexus-empty" }, "暂无图谱节点。拖入 Markdown（含 ## 章节或 [[双向链接]]）即可自动建图。");
			}
			return h("div", { className: "ds-mnexus-graph-box" },
				h("svg", { viewBox: "0 0 " + W + " " + H, style: { width: "100%", height: "auto", display: "block" } },
					edges.map((e, i) => {
						const a = pos[nodes.findIndex((x) => x.id === e.source)];
						const b = pos[nodes.findIndex((x) => x.id === e.target)];
						if (!a || !b) return null;
						return h("line", {
							key: "e" + i, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
							stroke: "var(--dsw-alias-border-l2,rgba(128,128,128,.6))", strokeWidth: 1,
						});
					}),
					nodes.map((n, i) => {
						const p = pos[i];
						if (!p) return null;
						const r = 5 + Math.min(8, deg[n.id] || 0);
						const active = props.center === n.title;
						return h("g", { key: "n" + n.id, className: "ds-mnexus-graph-node", onClick: () => props.onPick && props.onPick(n.title) },
							h("circle", {
								cx: p.x, cy: p.y, r: r,
								fill: active ? "#f59e0b" : "var(--dsw-alias-brand-primary,#4f8ef7)",
								fillOpacity: active ? 1 : 0.85,
							}),
							h("text", { x: p.x, y: p.y + r + 10, textAnchor: "middle", className: "ds-mnexus-graph-label" },
								n.title.length > 9 ? n.title.slice(0, 9) + "…" : n.title)
						);
					})
				)
			);
		}

		function MemoryPanel(props) {
			const sessionId = props.sessionId;
			const cwd = props.cwd;
			const onClose = props.onClose;

			const [tab, setTab] = React.useState("overview");
			const [dash, setDash] = React.useState(null);
			const [facts, setFacts] = React.useState([]);
			const [skills, setSkills] = React.useState([]);
			const [graph, setGraph] = React.useState(null);
			const [logs, setLogs] = React.useState([]);
			const [conflicts, setConflicts] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const [selected, setSelected] = React.useState([]);
			const [editId, setEditId] = React.useState(null);
			const [editText, setEditText] = React.useState("");
			const [kindFilter, setKindFilter] = React.useState("");
			const [factQuery, setFactQuery] = React.useState("");
			const [graphQuery, setGraphQuery] = React.useState("");
			const [graphCenter, setGraphCenter] = React.useState(null);
			const [linkForm, setLinkForm] = React.useState({ source: "", target: "", relation: "related" });

			const say = (text) => { setNotice(text); setTimeout(() => setNotice((cur) => (cur === text ? "" : cur)), 3200); };

			const loadDash = React.useCallback(() => {
				return api("dashboard", { sessionId }).then((r) => { if (r && r.ok) setDash(r); });
			}, [sessionId]);

			const loadFacts = React.useCallback(() => {
				return api("list_facts", { sessionId, kind: kindFilter || undefined, query: factQuery || undefined, limit: 200 })
					.then((r) => setFacts((r && r.facts) || []));
			}, [sessionId, kindFilter, factQuery]);

			const loadSkills = React.useCallback(() => {
				return api("skill_list", { sessionId, limit: 50 }).then((r) => setSkills((r && r.drafts) || []));
			}, [sessionId]);

			const loadGraph = React.useCallback((query) => {
				const action = query ? "graph_search" : "graph_view_global";
				return api(action, { sessionId, query, limit: 60 }).then((r) => setGraph(r || { nodes: [], edges: [] }));
			}, [sessionId]);

			const loadLogs = React.useCallback(() => {
				return api("audit_log", { sessionId, limit: 100 }).then((r) => setLogs((r && r.logs) || []));
			}, [sessionId]);

			const loadConflicts = React.useCallback(() => {
				return api("conflicts", { sessionId }).then((r) => setConflicts(r || null));
			}, [sessionId]);

			React.useEffect(() => { loadDash(); loadConflicts(); }, [loadDash, loadConflicts]);
			React.useEffect(() => {
				if (tab === "facts") loadFacts();
				if (tab === "skills") loadSkills();
				if (tab === "graph") loadGraph(graphQuery);
				if (tab === "audit") loadLogs();
			}, [tab, loadFacts, loadSkills, loadGraph, loadLogs, graphQuery]);

			const run = async (fn, successText) => {
				setBusy(true);
				try {
					const res = await fn();
					if (res && res.ok === false) { say("失败：" + res.error); return res; }
					say(successText || "已更新");
					return res;
				} catch (e) {
					say("出错：" + (e && e.message));
				} finally {
					setBusy(false);
				}
			};

			// ---- 记忆操作 ----
			const togglePin = (f) => run(() => api("pin_fact", { sessionId, factId: f.id, pinned: !f.pinned, actor: "user" })
				.then(() => loadFacts()).then(() => loadDash()), f.pinned ? "已取消置顶" : "已置顶");

			const saveEdit = (id) => run(() => api("update_fact", { sessionId, factId: id, patch: { content: editText }, actor: "user" })
				.then(() => { setEditId(null); return loadFacts().then(() => loadDash()); }), "已保存");

			const forgetOne = (id) => run(() => api("batch_forget", { sessionId, ids: [id], actor: "user" })
				.then(() => { setSelected((s) => s.filter((x) => x !== id)); return loadFacts().then(() => loadDash()); }), "已遗忘");

			const forgetSelected = () => run(() => api("batch_forget", { sessionId, ids: selected, actor: "user" })
				.then(() => { setSelected([]); return loadFacts().then(() => loadDash()); }), "已遗忘 " + selected.length + " 条");

			// ---- 技能草稿操作 ----
			const generateSkill = () => run(() => api("skill_generate", { sessionId, actor: "user" })
				.then((r) => { if (r && r.ok) say("已生成草稿：" + r.name); return loadSkills().then(() => loadDash()); }));

			const reviewSkill = (id, decision) => run(() => api("skill_review", { sessionId, draftId: id, decision, actor: "user" })
				.then(() => loadSkills().then(() => loadDash())), decision === "reject" ? "已驳回" : "已通过");

			const publishSkill = (id, scope) => run(() => api("skill_publish", { sessionId, draftId: id, scope, cwd, actor: "user" })
				.then((r) => { say(r && r.ok ? "已发布到 " + r.path : "发布失败"); return loadSkills().then(() => loadDash()); }));

			const deleteSkill = (id) => run(() => api("skill_delete", { sessionId, draftId: id, actor: "user" })
				.then(() => loadSkills().then(() => loadDash())), "已删除");

			// ---- 图谱操作 ----
			const pickNode = (title) => {
				setGraphCenter(title);
				api("graph_view_local", { sessionId, title, depth: 1 }).then((r) => {
					if (r && r.ok) setGraph({ nodes: r.nodes, edges: r.edges, center: title });
				});
			};
			const resetGraph = () => { setGraphCenter(null); loadGraph(""); };
			const createLink = () => run(() => api("graph_link", { sessionId, source: linkForm.source, target: linkForm.target, relation: linkForm.relation || "related" })
				.then((r) => { if (r && r.ok) { setLinkForm({ source: "", target: "", relation: "related" }); return loadGraph(graphQuery); } say("建链失败：" + r.error); }), "已建立关系");

			// ---- 渲染：概览 ----
			const renderOverview = () => {
				if (!dash) return h("div", { className: "ds-mnexus-empty" }, busy ? h("span", { className: "ds-mnexus-spin" }) : "加载中…");
				const l = dash.layers || {};
				const cards = [
					{ label: "🧠 L3 语义记忆", value: l.l3 ? l.l3.active : 0, sub: "共 " + (l.l3 ? l.l3.facts : 0) + " 条 · 置顶 " + (l.l3 ? l.l3.pinned : 0) },
					{ label: "💬 L2 情景记忆", value: l.l2 ? l.l2.messages : 0, sub: (l.l2 ? l.l2.tokens : 0) + " tokens · 今日 " + (l.l2 ? l.l2.today : 0) },
					{ label: "🧩 L4 程序记忆", value: l.l4 ? l.l4.published : 0, sub: "草稿 " + (l.l4 ? l.l4.drafts : 0) + " · 待审 " + (l.l4 ? l.l4.approved : 0) },
					{ label: "🕸️ 知识图谱", value: l.graph ? l.graph.nodes : 0, sub: (l.graph ? l.graph.edges : 0) + " 条关系" },
					{ label: "📸 快照备份", value: l.l2 ? l.l2.snapshots : 0, sub: "可回滚节点" },
					{ label: "💾 数据库体积", value: fmtSize(dash.db_size_bytes), sub: "版本 " + (l.l3 ? l.l3.versions : 0) + " 条变更" },
				];
				return h("div", null,
					h("div", { className: "ds-mnexus-cards" },
						cards.map((c, i) => h("div", { key: i, className: "ds-mnexus-card" },
							h("div", { className: "ds-mnexus-card-label" }, c.label),
							h("div", { className: "ds-mnexus-card-value" }, String(c.value)),
							h("div", { className: "ds-mnexus-card-sub" }, c.sub)
						))
					),
					h("div", { className: "ds-mnexus-section-title" }, "⚠️ 记忆健康"),
					h("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary)", lineHeight: "1.8" } },
						h("div", null, "· 已过期记忆：" + (l.l3 ? l.l3.expired : 0) + " 条（自动衰减，不占用召回）"),
						h("div", null, "· 内容冲突：" + (dash.conflicts || 0) + " 组（同类重复内容，建议合并）"),
						h("div", null, "· L1 运行记忆：进程内，未落库（" + (l.l1 ? l.l1.note : "-") + "）")
					),
					(conflicts && conflicts.total > 0) ? h("div", null,
						h("div", { className: "ds-mnexus-section-title" }, "🔁 冲突记忆"),
						conflicts.conflicts.slice(0, 5).map((g, i) => h("div", { key: i, className: "ds-mnexus-row" },
							h("div", { className: "ds-mnexus-row-main" },
								h("div", null, g.items[0] ? g.items[0].content.slice(0, 90) : ""),
								h("div", { className: "ds-mnexus-row-meta" },
									h("span", { className: "ds-mnexus-tag kind" }, KIND_LABEL[g.kind] || g.kind),
									h("span", null, "重复 " + g.count + " 次")
								)
							),
							h("div", { className: "ds-mnexus-actions" },
								h("button", {
									className: "ds-mnexus-btn danger",
									onClick: () => run(() => api("batch_forget", { sessionId, ids: g.items.slice(1).map((x) => x.id), actor: "user" })
										.then(() => loadConflicts().then(() => loadFacts()).then(() => loadDash())), "已保留最新一条，清理重复"),
								}, "只留最新")
							)
						))
					) : null
				);
			};

			// ---- 渲染：语义记忆 ----
			const renderFacts = () => h("div", null,
				h("div", { className: "ds-mnexus-toolbar" },
					h("input", {
						className: "ds-mnexus-input", placeholder: "搜索记忆内容…", value: factQuery,
						onChange: (e) => setFactQuery(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") loadFacts(); },
					}),
					h("select", {
						className: "ds-mnexus-select", value: kindFilter,
						onChange: (e) => { setKindFilter(e.target.value); },
					},
						h("option", { value: "" }, "全部类型"),
						h("option", { value: "fact" }, "事实"),
						h("option", { value: "core_preference" }, "核心偏好"),
						h("option", { value: "lesson" }, "教训"),
						h("option", { value: "chat" }, "聊天碎片")
					),
					h("button", { className: "ds-mnexus-btn", onClick: loadFacts, disabled: busy }, "刷新"),
					h("button", {
						className: "ds-mnexus-btn danger", disabled: busy || selected.length === 0,
						onClick: forgetSelected,
					}, "遗忘选中 (" + selected.length + ")")
				),
				facts.length === 0 ? h("div", { className: "ds-mnexus-empty" }, "还没有语义记忆。对话中让助手记住信息，或用 ✨ 按钮查看召回。")
					: facts.map((f) => h("div", { key: f.id, className: "ds-mnexus-row" + (f.pinned ? " pinned" : "") },
						h("input", {
							type: "checkbox", style: { marginTop: "3px", flex: "none" },
							checked: selected.includes(f.id),
							onChange: (e) => setSelected((s) => (e.target.checked ? s.concat([f.id]) : s.filter((x) => x !== f.id))),
						}),
						h("div", { className: "ds-mnexus-row-main" },
							editId === f.id
								? h("textarea", {
									className: "ds-mnexus-textarea", value: editText,
									onChange: (e) => setEditText(e.target.value),
								})
								: h("div", null, (f.pinned ? "📌 " : "") + f.content),
							h("div", { className: "ds-mnexus-row-meta" },
								h("span", { className: "ds-mnexus-tag kind" }, KIND_LABEL[f.kind] || f.kind),
								h("span", { className: "ds-mnexus-tag" }, "重要度 " + Number(f.importance || 0).toFixed(2)),
								h("span", { className: "ds-mnexus-tag" }, "v" + (f.version || 1)),
								h("span", { className: "ds-mnexus-tag" }, f.expires_at ? "过期 " + fmtTime(f.expires_at) : "永久"),
								h("span", { className: "ds-mnexus-tag" }, "更新 " + fmtTime(f.updated_at))
							)
						),
						h("div", { className: "ds-mnexus-actions" },
							editId === f.id
								? h("button", { className: "ds-mnexus-btn primary", disabled: busy, onClick: () => saveEdit(f.id) }, "保存")
								: h("button", {
									className: "ds-mnexus-btn", disabled: busy,
									onClick: () => { setEditId(f.id); setEditText(f.content); },
								}, "编辑"),
							editId === f.id ? h("button", { className: "ds-mnexus-btn", onClick: () => setEditId(null) }, "取消") : null,
							h("button", { className: "ds-mnexus-btn", disabled: busy, onClick: () => togglePin(f) }, f.pinned ? "取消置顶" : "置顶"),
							h("button", { className: "ds-mnexus-btn danger", disabled: busy, onClick: () => forgetOne(f.id) }, "遗忘")
						)
					))
			);

			// ---- 渲染：技能草稿 ----
			const renderSkills = () => h("div", null,
				h("div", { className: "ds-mnexus-toolbar" },
					h("button", { className: "ds-mnexus-btn primary", disabled: busy, onClick: generateSkill }, "📝 从当前会话生成草稿"),
					h("button", { className: "ds-mnexus-btn", disabled: busy, onClick: loadSkills }, "刷新")
				),
				skills.length === 0 ? h("div", { className: "ds-mnexus-empty" }, "还没有技能草稿。点上方按钮把本次会话沉淀成可复用的 Skill。")
					: skills.map((d) => h("div", { key: d.id, className: "ds-mnexus-row" },
						h("div", { className: "ds-mnexus-row-main" },
							h("div", { style: { fontWeight: 600 } }, d.name),
							h("div", { style: { marginTop: "4px" } }, d.description),
							h("div", { className: "ds-mnexus-row-meta" },
								h("span", { className: "ds-mnexus-tag kind" }, d.status),
								h("span", { className: "ds-mnexus-tag" }, d.source === "imported" ? "外部导入" : "会话生成"),
								d.published_path ? h("span", { className: "ds-mnexus-tag" }, d.published_path) : null,
								h("span", { className: "ds-mnexus-tag" }, "更新 " + fmtTime(d.updated_at))
							)
						),
						h("div", { className: "ds-mnexus-actions" },
							d.status !== "rejected" ? h("button", { className: "ds-mnexus-btn ok", disabled: busy, onClick: () => reviewSkill(d.id, "approve") }, "通过") : null,
							d.status !== "rejected" ? h("button", { className: "ds-mnexus-btn warnc", disabled: busy, onClick: () => reviewSkill(d.id, "reject") }, "驳回") : null,
							h("button", { className: "ds-mnexus-btn primary", disabled: busy, onClick: () => publishSkill(d.id, "project") }, "发布到项目"),
							h("button", { className: "ds-mnexus-btn", disabled: busy, onClick: () => publishSkill(d.id, "user") }, "发布到全局"),
							h("button", { className: "ds-mnexus-btn danger", disabled: busy, onClick: () => deleteSkill(d.id) }, "删除")
						)
					))
			);

			// ---- 渲染：知识图谱 ----
			const renderGraph = () => h("div", null,
				h("div", { className: "ds-mnexus-toolbar" },
					h("input", {
						className: "ds-mnexus-input", placeholder: "搜索节点…", value: graphQuery,
						onChange: (e) => setGraphQuery(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") { setGraphCenter(null); loadGraph(graphQuery); } },
					}),
					h("button", { className: "ds-mnexus-btn", disabled: busy, onClick: () => { setGraphCenter(null); loadGraph(graphQuery); } }, "搜索"),
					h("button", { className: "ds-mnexus-btn", disabled: busy, onClick: resetGraph }, "重置视图")
				),
				h(GraphCanvas, { nodes: (graph && graph.nodes) || [], edges: (graph && graph.edges) || [], center: graphCenter, onPick: pickNode }),
				h("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", margin: "8px 0 14px" } },
					"节点 " + ((graph && graph.nodes) || []).length + " 个 · 关系 " + ((graph && graph.edges) || []).length + " 条"
					+ (graphCenter ? " · 当前中心：" + graphCenter + "（点击节点看邻域）" : " · 点击节点查看一跳邻域")
				),
				h("div", { className: "ds-mnexus-section-title" }, "➕ 手动建立关系"),
				h("div", { className: "ds-mnexus-toolbar" },
					h("input", {
						className: "ds-mnexus-input", placeholder: "源节点", value: linkForm.source,
						onChange: (e) => setLinkForm((s) => Object.assign({}, s, { source: e.target.value })),
					}),
					h("input", {
						className: "ds-mnexus-input", placeholder: "关系（如 causes / contains）", value: linkForm.relation,
						onChange: (e) => setLinkForm((s) => Object.assign({}, s, { relation: e.target.value })),
					}),
					h("input", {
						className: "ds-mnexus-input", placeholder: "目标节点", value: linkForm.target,
						onChange: (e) => setLinkForm((s) => Object.assign({}, s, { target: e.target.value })),
					}),
					h("button", { className: "ds-mnexus-btn primary", disabled: busy || !linkForm.source || !linkForm.target, onClick: createLink }, "建立")
				)
			);

			// ---- 渲染：审计日志 ----
			const renderAudit = () => h("div", null,
				logs.length === 0 ? h("div", { className: "ds-mnexus-empty" }, "暂无操作记录。")
					: logs.map((l) => h("div", { key: l.id, className: "ds-mnexus-log" },
						h("span", { className: "ds-mnexus-log-time" }, fmtTime(l.created_at)),
						h("span", { className: "ds-mnexus-log-actor" }, l.actor),
						h("span", { style: { flex: 1 } }, l.action + (l.target_id ? " #" + l.target_id : "") + (l.detail ? " — " + String(l.detail).slice(0, 80) : ""))
					))
			);

			return h(React.Fragment, null,
				h("div", { className: "ds-mnexus-scrim", onClick: () => { if (!busy) onClose(); } }),
				h("div", { className: "ds-mnexus-panel" },
					h("div", { className: "ds-mnexus-panel-head" },
						h("div", { className: "ds-mnexus-panel-title" }, "🧠 记忆中枢 — 四层记忆 / 技能 / 图谱"),
						busy ? h("span", { className: "ds-mnexus-spin" }) : null,
						h("button", { className: "ds-mnexus-panel-close", onClick: () => { if (!busy) onClose(); } }, "×")
					),
					h("div", { className: "ds-mnexus-tabs" },
						TABS.map((t) => h("div", {
							key: t.key,
							className: "ds-mnexus-tab" + (tab === t.key ? " active" : ""),
							onClick: () => setTab(t.key),
						}, t.label))
					),
					h("div", { className: "ds-mnexus-body" },
						tab === "overview" ? renderOverview() : null,
						tab === "facts" ? renderFacts() : null,
						tab === "skills" ? renderSkills() : null,
						tab === "graph" ? renderGraph() : null,
						tab === "audit" ? renderAudit() : null
					),
					h("div", { className: "ds-mnexus-foot" },
						h("span", null, notice || (dash ? "记忆数据库：" + fmtSize(dash.db_size_bytes) : "加载中…")),
						h("span", { style: { marginLeft: "auto" } }, sessionId ? "会话 " + String(sessionId).slice(0, 12) : "无会话")
					)
				)
			);
		}

		// 记忆面板按钮
		function MemoryPanelButton(props) {
			const sessionId = props.sessionId;
			const cwd = props.cwd;
			const [open, setOpen] = React.useState(false);
			const [draftCount, setDraftCount] = React.useState(0);

			React.useEffect(() => {
				if (!sessionId) return;
				api("skill_list", { sessionId, status: "draft", limit: 20 }).then((res) => {
					if (res && res.drafts) setDraftCount(res.drafts.length);
				});
			}, [sessionId, open]);

			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [open]);

			return h("div", { style: { position: "relative" } },
				h("div", {
					className: "ds-mnexus-btn-wrap ds-mnexus-btn-normal",
					disabled: !sessionId,
					onClick: (e) => { e.stopPropagation(); setOpen(true); },
					title: "记忆中枢：四层记忆 / 技能草稿 / 知识图谱",
				},
					"🧠",
					draftCount > 0 ? h("span", { className: "ds-mnexus-badge" }) : null
				),
				open ? h(MemoryPanel, { sessionId: sessionId, cwd: cwd, onClose: () => setOpen(false) }) : null
			);
		}

		// ===== P3: 企业安全模式面板 =====
		function SecurityPanel(props) {
			const { sessionId, onClose } = props;
			const [enterpriseMode, setEnterpriseMode] = React.useState(false);
			const [orgId, setOrgId] = React.useState("");
			const [role, setRole] = React.useState("user");
			const [securityStats, setSecurityStats] = React.useState(null);
			const [snapshots, setSnapshots] = React.useState([]);
			const [loading, setLoading] = React.useState(false);

			React.useEffect(() => {
				if (!sessionId) return;
				Promise.all([
					api("security_check", { sessionId, actor: "user" }),
					api("get_org_scope", { sessionId }),
					api("security_stats", { sessionId }),
					api("list_snapshots", { sessionId }),
				]).then(([check, org, stats, snap]) => {
					setEnterpriseMode(check?.role === "user" ? false : true);
					setOrgId(org?.org_id || "");
					setSecurityStats(stats);
					setSnapshots(snap?.snapshots || []);
				});
			}, [sessionId]);

			const handleToggleEnterprise = () => {
				api("toggle_enterprise_mode", { sessionId, enabled: !enterpriseMode }).then(() => {
					setEnterpriseMode(!enterpriseMode);
				});
			};

			const handleSetOrg = () => {
				api("set_org_scope", { sessionId, orgId: orgId || null }).then(() => {
					alert(orgId ? `已设置组织隔离: ${orgId}` : "已清除组织隔离");
				});
			};

			const handleRestoreSnapshot = (id) => {
				if (!confirm("确定要恢复此快照吗？当前配置将被替换。")) return;
				api("restore_snapshot", { sessionId, snapshotId: id }).then((res) => {
					if (res.ok) alert("快照已恢复");
					else alert("恢复失败: " + (res.error || "未知错误"));
				});
			};

			const handleDeleteSnapshot = (id) => {
				if (!confirm("确定要删除此快照吗？")) return;
				api("delete_snapshot", { sessionId, snapshotId: id }).then((res) => {
					if (res.ok) {
						setSnapshots(snapshots.filter(s => s.id !== id));
					}
				});
			};

			return h("div", { className: "ds-mnexus-scrim", onClick: onClose },
				h("div", {
					className: "ds-mnexus-panel",
					onClick: (e) => e.stopPropagation(),
				},
					// 头部
					h("div", { className: "ds-mnexus-panel-head" },
						h("span", { className: "ds-mnexus-panel-title" }, "🔒 企业安全模式"),
						h("button", { className: "ds-mnexus-panel-close", onClick: onClose }, "×")
					),
					// 内容
					h("div", { className: "ds-mnexus-body" },
						// 安全模式开关
						h("div", { className: "ds-mnexus-section-title" }, "🛡️ 安全模式"),
						h("div", { className: "ds-mnexus-card" },
							h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
								h("div", null,
									h("div", { style: { fontWeight: 600, marginBottom: 4 } }, "企业安全模式"),
									h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
										enterpriseMode ? "已启用：Agent 权限受限，支持组织隔离" : "未启用：所有角色拥有完整权限"
									)
								),
								h("button", {
									className: "ds-mnexus-btn" + (enterpriseMode ? " primary" : ""),
									onClick: handleToggleEnterprise,
									style: { background: enterpriseMode ? "var(--dsw-alias-brand-primary,#4f8ef7)" : "", color: "#fff" },
								}, enterpriseMode ? "已启用" : "启用")
							)
						),
						// 组织隔离
						h("div", { className: "ds-mnexus-section-title", style: { marginTop: 16 } }, "🏢 组织隔离"),
						h("div", { className: "ds-mnexus-card" },
							h("div", { className: "ds-mnexus-row" },
								h("input", {
									className: "ds-mnexus-input",
									placeholder: "输入组织 ID（可选）",
									value: orgId,
									onChange: (e) => setOrgId(e.target.value),
								}),
								h("button", { className: "ds-mnexus-btn primary", onClick: handleSetOrg, style: { background: "var(--dsw-alias-brand-primary,#4f8ef7)", color: "#fff" } }, "设置")
							)
						),
						// 角色权限
						h("div", { className: "ds-mnexus-section-title", style: { marginTop: 16 } }, "👤 角色权限"),
						h("div", { className: "ds-mnexus-cards" },
							h("div", { className: "ds-mnexus-card" },
								h("div", { className: "ds-mnexus-card-label" }, "当前角色"),
								h("div", { className: "ds-mnexus-card-value", style: { fontSize: 16 } }, role.toUpperCase())
							),
							h("div", { className: "ds-mnexus-card" },
								h("div", { className: "ds-mnexus-card-label" }, "允许的操作"),
								h("div", { className: "ds-mnexus-card-value", style: { fontSize: 16 } }, securityStats?.agent_operations || 0)
							),
							h("div", { className: "ds-mnexus-card" },
								h("div", { className: "ds-mnexus-card-label" }, "拒绝次数"),
								h("div", { className: "ds-mnexus-card-value", style: { fontSize: 16 } }, securityStats?.denied_operations || 0)
							),
						),
						// 环境快照
						h("div", { className: "ds-mnexus-section-title", style: { marginTop: 16 } }, "💾 环境快照"),
						snapshots.length === 0
							? h("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 13, padding: "12px 0" } }, "暂无快照")
							: snapshots.map(s =>
								h("div", { key: s.id, className: "ds-mnexus-row" },
									h("div", { style: { flex: 1 } },
										h("div", { style: { fontWeight: 600, fontSize: 13 } }, `快照 v${s.version}`),
										h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
											new Date(s.timestamp).toLocaleString() + " · " + s.memory_count + " 条记忆"
										)
									),
									h("button", {
										className: "ds-mnexus-btn",
										onClick: () => handleRestoreSnapshot(s.id),
										style: { marginRight: 4 },
									}, "恢复"),
									h("button", {
										className: "ds-mnexus-btn",
										onClick: () => handleDeleteSnapshot(s.id),
										style: { color: "#ef4444" },
									}, "删除")
								)
							)
					),
					// 底部
					h("div", { className: "ds-mnexus-foot" },
						h("span", null, "企业安全模式用于多租户隔离和 Agent 权限控制"),
					)
				)
			);
		}

		function SecurityPanelButton(props) {
			const sessionId = props.sessionId;
			const [open, setOpen] = React.useState(false);

			return h("div", { style: { position: "relative" } },
				h("div", {
					className: "ds-mnexus-btn-wrap ds-mnexus-btn-normal",
					disabled: !sessionId,
					onClick: (e) => { e.stopPropagation(); setOpen(true); },
					title: "企业安全模式：权限控制 / 组织隔离 / 环境快照",
				}, "🔒"),
				open ? h(SecurityPanel, { sessionId, onClose: () => setOpen(false) }) : null
			);
		}

		// 主插件 apply
		function apply(ctx) {
			const slots = ctx.slots !== undefined ? ctx.slots : ctx.get("slots");
			if (slots === undefined) return;

			// 注入压缩按钮到输入框右侧
			slots.inject("conversation.input.actions.right", () => slots.register(
				{ name: "conversation.input.actions.right", id: "dsh-memory-nexus-compress", order: 10, label: "上下文压缩" },
				(props) => React.createElement(CompressButton, props)
			));

			// 注入增强提示词按钮
			slots.inject("conversation.input.actions.right", () => slots.register(
				{ name: "conversation.input.actions.right", id: "dsh-memory-nexus-enhance", order: 11, label: "增强提示词" },
				(props) => React.createElement(EnhancePromptButton, props)
			));

			// 注入记忆中枢面板按钮（P2）
			slots.inject("conversation.input.actions.right", () => slots.register(
				{ name: "conversation.input.actions.right", id: "dsh-memory-nexus-panel", order: 12, label: "记忆中枢" },
				(props) => React.createElement(MemoryPanelButton, props)
			));

			// 注入企业安全模式按钮（P3）
			slots.inject("conversation.input.actions.right", () => slots.register(
				{ name: "conversation.input.actions.right", id: "dsh-memory-nexus-security", order: 13, label: "安全模式" },
				(props) => React.createElement(SecurityPanelButton, props)
			));
		}

		function memoryNexus() {}
		memoryNexus.inject = ["slots"];
		memoryNexus.apply = apply;
		module.exports = memoryNexus;
		return module.exports;
	},
});
