"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { encodeFilePathForApi, getRelativeFilePath, joinFilePath } from "@/lib/file-paths";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string) => void;
}

async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) {
    let message = `Failed to load files (HTTP ${res.status})`;
    try {
      const data = await res.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshKey,
  onFileDeleted,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshKey?: number;
  onFileDeleted?: () => void;
}) {
  const open = expandedPaths.has(node.fullPath);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  // When refreshKey causes a re-render with the same node identity, reload open dirs
  const prevLoadedRef = useRef(loaded);
  useEffect(() => {
    prevLoadedRef.current = loaded;
  });

  // Re-fetch children when refreshKey changes and the directory is already open/loaded
  useEffect(() => {
    if (open && loaded) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded]);

  // 删除文件（只对文件，不对目录）
  const handleDeleteFile = useCallback(async () => {
    if (node.isDir) return;
    setDeleting(true);
    try {
      const encoded = node.fullPath.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`/api/files/${encoded}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `删除失败 ${res.status}`);
      }
      onFileDeleted?.();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [node.isDir, node.fullPath, onFileDeleted]);

  return (
    <div>
      <div
        onClick={confirmDelete ? undefined : handleClick}
        onContextMenu={(e) => {
          // 右键：只对文件弹出删除确认
          if (node.isDir) return;
          e.preventDefault();
          e.stopPropagation();
          setConfirmDelete(true);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); if (confirmDelete) setConfirmDelete(false); }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: confirmDelete ? "default" : "pointer",
          background: confirmDelete ? "rgba(239,68,68,0.10)" : (hovered ? "var(--bg-hover)" : "transparent"),
          borderLeft: confirmDelete ? "2px solid #ef4444" : "2px solid transparent",
          borderRadius: 4,
          userSelect: "none",
        }}
      >
        {confirmDelete ? (
          <>
            <span style={{ fontSize: 11, color: "#ef4444", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              删除「{node.name}」？
            </span>
            <button
              onClick={handleDeleteFile}
              disabled={deleting}
              title="确认删除"
              style={{
                background: deleting ? "#999" : "#ef4444", color: "#fff", border: "none",
                borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: deleting ? "wait" : "pointer",
                height: 18, flexShrink: 0,
              }}
            >
              {deleting ? "…" : "删除"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              title="取消"
              style={{
                background: "none", color: "var(--text-dim)", border: "1px solid var(--border)",
                borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer",
                height: 18, flexShrink: 0,
              }}
            >
              取消
            </button>
          </>
        ) : (
        <>
        {node.isDir && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={node.fullPath}
        >
          {node.name}
        </span>
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {hovered && (
          <div style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}>
            {onAtMention && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAtMention(getRelativeFilePath(node.fullPath, cwd));
                }}
                title="Insert path into chat"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  padding: "0 8px",
                  height: 20,
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
                </svg>
                mention
              </button>
            )}
            {/* 删除按钮：只对文件显示，紧跟 mention 后 */}
            {!node.isDir && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
                disabled={deleting}
                title="删除文件"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "#ef4444",
                  cursor: deleting ? "wait" : "pointer",
                  flexShrink: 0,
                }}
              >
                {deleting ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                )}
              </button>
            )}
          </div>
        )}
        </>
        )}
      </div>
      {node.isDir && open && (
        <div>
          {children.map((child) => (
            <TreeNode key={child.fullPath} node={child} depth={depth + 1} cwd={cwd} onOpenFile={onOpenFile} onAtMention={onAtMention} expandedPaths={expandedPaths} onToggleExpanded={onToggleExpanded} refreshKey={refreshKey} onFileDeleted={onFileDeleted} />
          ))}
          {children.length === 0 && loaded && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ cwd, onOpenFile, refreshKey, onAtMention }: Props) {
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const prevCwdRef = useRef<string | null>(null);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) setExpandedPaths(new Set());

    setLoading(cwdChanged);
    setError(null);
    fetchEntries(cwd)
      .then((entries) => setRoots(entries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [cwd, refreshKey]);

  // 文件删除后重新加载根目录
  const handleFileDeleted = useCallback(() => {
    fetchEntries(cwd)
      .then((entries) => setRoots(entries))
      .catch(() => { /* ignore */ });
  }, [cwd]);

  if (loading) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
        Loading files...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ padding: "2px 4px" }}>
      {roots.map((node) => (
        <TreeNode
          key={node.fullPath}
          node={node}
          depth={0}
          cwd={cwd}
          onOpenFile={onOpenFile}
          onAtMention={onAtMention}
          expandedPaths={expandedPaths}
          onToggleExpanded={handleToggleExpanded}
          refreshKey={refreshKey}
          onFileDeleted={handleFileDeleted}
        />
      ))}
      {roots.length === 0 && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
          No files found
        </div>
      )}
    </div>
  );
}
