"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  cwd: string;
  onClose: () => void;
}

interface MemoryData {
  filePath: string;
  fileName: string;
  content: string;
  exists: boolean;
  candidates: string[];
  global: {
    filePath: string;
    content: string;
    exists: boolean;
  };
}

const DEFAULT_TEMPLATE = `# AGENTS.md - PI 智能体行为约束

> PI 在每次会话启动时会自动读取本文件。在此写入的规则将约束 PI 的行为。

## 行为准则
- 执行删除、移动、重命名文件等不可逆操作前，必须先向用户确认
- 安装/卸载软件包（npm install / pip install 等）前必须先询问
- 不要主动修改未提及的文件
- 遇到不确定的情况，优先询问而非自行决定

## 工作偏好
- 用中文回复
- 代码改动前先说明意图
- 优先选择最简方案
`;

export function MemoryConfig({ cwd, onClose }: Props) {
  const [data, setData] = useState<MemoryData | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) throw new Error(`加载失败 ${res.status}`);
      const d: MemoryData = await res.json();
      setData(d);
      // ★ 直接映射全局文件（~/AGENTS.md）：所有项目共享的 PI 全局约束，不跟随 cwd
      setContent(d.global.exists ? d.global.content : DEFAULT_TEMPLATE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // ★ 保存到全局文件（~/AGENTS.md）：所有项目共享的约束
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: data.global.filePath, content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `保存失败 ${res.status}`);
      }
      setSaved(true);
      // 重新加载，同步 global 状态
      load();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [data, content, load]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)",
          maxHeight: "86vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span style={{ fontWeight: 600, color: "var(--text)" }}>
              全局记忆与行为约束
            </span>
          </div>
          <button
            onClick={onClose}
            title="关闭"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 说明 */}
        <div
          style={{
            padding: "10px 18px",
            background: "var(--bg-subtle)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.6,
          }}
        >
          📍 全局文件：<code style={{ color: "var(--accent)" }}>{data?.global.filePath?.replace(/^\/Users\/[^/]+/, "~") ?? "~/AGENTS.md"}</code>
          <br />
          🌐 <strong>全局约束</strong>：PI 在<strong>所有项目</strong>启动会话时都会读取本文件，规则适用于全部工作目录。
          {!data?.global.exists && !loading && "（当前不存在，保存后会自动创建，并填入推荐模板）"}
        </div>

        {/* 编辑器 */}
        <div style={{ flex: 1, overflow: "hidden", padding: 12 }}>
          {loading ? (
            <div style={{ color: "var(--text-dim)", textAlign: "center", padding: 40 }}>
              加载中...
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              style={{
                width: "100%",
                height: "100%",
                minHeight: 340,
                resize: "none",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                background: "var(--bg-panel)",
                color: "var(--text)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 13,
                lineHeight: 1.6,
                outline: "none",
              }}
            />
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div style={{ padding: "0 18px 8px", fontSize: 12, color: "#ef4444" }}>
            ⚠️ {error}
          </div>
        )}

        {/* 底部操作栏 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {data?.global.exists ? "✏️ 编辑全局约束（所有项目生效）" : "📝 创建全局约束文件（保存后所有项目生效）"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {saved && (
              <span style={{ fontSize: 12, color: "#16a34a", alignSelf: "center" }}>
                ✅ 已保存
              </span>
            )}
            <button
              onClick={save}
              disabled={saving || loading}
              style={{
                padding: "8px 20px",
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: saving ? "wait" : "pointer",
                fontSize: 13,
                fontWeight: 500,
                opacity: saving || loading ? 0.6 : 1,
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
