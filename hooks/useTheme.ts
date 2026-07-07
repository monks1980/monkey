"use client";

import { useCallback, useSyncExternalStore } from "react";

// 扩展为多主题：light / dark / sky(天蓝) / mint(薄荷绿) / pink(粉色)
export type Theme = "light" | "dark" | "sky" | "mint" | "pink";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "白色" },
  { id: "dark", label: "黑色" },
  { id: "sky", label: "天蓝" },
  { id: "mint", label: "薄荷绿" },
  { id: "pink", label: "粉色" },
];

const THEME_CLASSES: Record<Theme, string> = {
  light: "",
  dark: "dark",
  sky: "theme-sky",
  mint: "theme-mint",
  pink: "theme-pink",
};

const listeners = new Set<() => void>();

function getStoredTheme(): Theme {
  if (typeof document === "undefined") return "light";
  try {
    const stored = localStorage.getItem("pi-theme") as Theme | null;
    if (stored && stored in THEME_CLASSES) return stored;
  } catch {
    // ignore
  }
  // 首次访问：检测是否已应用 dark class（兼容旧逻辑）
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let currentSnapshot: Theme | null = null;
function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  if (currentSnapshot === null) currentSnapshot = getStoredTheme();
  return currentSnapshot;
}

function getServerSnapshot(): Theme {
  return "light";
}

type ToggleOrigin = { x: number; y: number };

function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  // 清除所有主题 class
  Object.values(THEME_CLASSES).forEach((cls) => {
    if (cls) root.classList.remove(cls);
  });
  const cls = THEME_CLASSES[theme];
  if (cls) root.classList.add(cls);
  currentSnapshot = theme;
  try {
    localStorage.setItem("pi-theme", theme);
  } catch {
    // ignore
  }
  listeners.forEach((cb) => cb());
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme, origin?: ToggleOrigin) => {
    const apply = () => applyThemeClass(next);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  // 保留 toggleTheme 向后兼容（light <-> dark 切换）
  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const current = getSnapshot();
    const next: Theme = current === "dark" ? "light" : "dark";
    setTheme(next, origin);
  }, [setTheme]);

  return { theme, toggleTheme, setTheme, isDark: theme === "dark" };
}
