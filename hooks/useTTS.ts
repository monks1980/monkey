"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * 把 Markdown 报告二次加工成「适合朗读、不看屏幕也能听懂」的口语稿。
 *
 * 用户需求：
 *   - 页面仍显示原始报告（本函数不改报告内容），口语稿只喂给 TTS
 *   - ★ 大标题（一、二、三、四…）和小标题都必须读出来，体现文章结构层次
 *   - ★ 列表/表格前加引导语（"下面是表格""下面分几点"），让人有预期
 *   - 去掉格式符号（** | ` # emoji 等），不读纯视觉元素
 *
 * 标题处理：每个标题都明确朗读，前面带层级词（"第一章""第一节""第一部分"），
 * 让听者凭耳朵就能建立结构。
 */
function buildSpeechScript(md: string): string {
  // 1) 代码块智能处理：
  //    ★ 纯代码（if/for/括号/函数体）→ 跳过，只读"下面是代码，跳过"
  //    ★ 文字内容（说明/命令/配置示例/JSON值）→ 保留朗读（去格式符号）
  //    判断依据：代码符号密度（{}();=><+ 等）高 = 纯代码；低 = 文字
  const isMostlyCode = (code: string): boolean => {
    // 去掉语言标记行和空行
    const lines = code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("```"));
    if (lines.length === 0) return true;
    const codeSymbols = (code.match(/[{}()\[\];=><+\-*/\\$&|!?:@]/g) || []).length;
    const totalChars = code.replace(/\s/g, "").length;
    if (totalChars === 0) return true;
    // 代码符号占比 > 12% 判定为纯代码（经验阈值）
    // 纯代码通常 15-30%，纯文字通常 < 5%
    return codeSymbols / totalChars > 0.12;
  };

  let text = md.replace(/```[\s\S]*?```/g, (block) => {
    const langMatch = block.match(/^```(\w*)/);
    const lang = (langMatch?.[1] || "").toLowerCase();
    // mermaid 永远是图谱
    if (lang === "mermaid") return `\n\n下面是图谱或流程图，跳过朗读。\n\n`;

    const lines = block.split("\n").length - 2;
    // ★ 智能判断：纯代码跳过，文字内容保留
    if (isMostlyCode(block)) {
      const langWord = lang ? `${lang} ` : "";
      return `\n\n下面是${langWord}代码部分，共${lines}行，跳过朗读。\n\n`;
    } else {
      // 文字内容 → 保留，去 ``` 和语言标记，作为正文朗读
      const content = block.replace(/^```\w*\n?/, "").replace(/```$/, "").trim();
      return `\n\n${content}\n\n`;
    }
  });
  text = text.replace(/<!--[\s\S]*?-->/g, "\n");
  // HTML 块（如 mermaid 图谱语法 <svg>、HTML 表格）→ 跳过提示
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "\n\n下面是矢量图谱，跳过朗读。\n\n");
  text = text.replace(/<[^>]+>/g, " ");
  // 图片 ![alt](url) → 跳过提示（优先用 alt 文字描述是什么图）
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => {
    const desc = alt?.trim();
    return `\n\n下面是${desc ? `图片：${desc}` : "图片"}，跳过朗读。\n\n`;
  });
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/g, " ");

  const cleanInline = (s: string): string =>
    s
      .replace(/`[^`]+`/g, (m) => m.replace(/`/g, ""))
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/==([^=]+)==/g, "$1");

  // 标题层级 → 口语引导词。不同级别用不同量词，体现层次。
  // h1 = 整体主题；h2 = 大章节（第一部分）；h3 = 小节（第一节）；h4+ = 更细
  const headingLeadWord = (level: number): string => {
    if (level <= 1) return "";
    if (level === 2) return "部分";
    if (level === 3) return "节";
    if (level === 4) return "点";
    return "项";
  };

  // 把已见标题计数，用于「第X部分/节」的序号
  const levelCount: Record<number, number> = {};
  const cnNum = (n: number): string => {
    const cn = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if (n <= 10) return cn[n];
    if (n < 20) return "十" + (n % 10 ? cn[n % 10] : "");
    return String(n); // 超过用阿拉伯数字
  };

  const paragraphs = text.split(/\n{2,}/);
  const speech: string[] = [];

  for (let para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // —— 标题段：★ 必须读出来，体现结构层次
    const headingMatch = lines[0].match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = cleanInline(headingMatch[2]).replace(/[#|>`~*_=\-]/g, "").trim();
      // 收集标题段里的副标题/短解说（非引用），合并到标题一起读，避免割裂
      const restLines = lines.slice(1).filter((l) => !l.startsWith(">"));
      let fullTitle = title;
      if (restLines.length > 0) {
        const first = cleanInline(restLines[0]).replace(/[#|>`~*_=\-]/g, "").trim();
        if (first && first.length <= 40 && !/[。．！？!?]/.test(first)) {
          fullTitle = `${title}，${first}`;
        }
      }
      if (level === 1) {
        // 一级大标题：整体主题
        speech.push(`主题：${fullTitle}。`);
      } else {
        // 二级及以下：带「第X部分/节」序号读出，体现层次结构
        levelCount[level] = (levelCount[level] || 0) + 1;
        // 更深的层级计数清零（进入新章节）
        for (let l = level + 1; l <= 6; l++) levelCount[l] = 0;
        const lead = headingLeadWord(level);
        speech.push(`第${cnNum(levelCount[level])}${lead}，${fullTitle}。`);
      }
      continue;
    }

    // —— 引用块：口语化朗读（去掉 >，保留内容，因为是结论性内容）
    if (lines.every((l) => l.startsWith(">"))) {
      const content = lines
        .map((l) => cleanInline(l.replace(/^>\s?/, "")))
        .join(" ")
        .replace(/[#|>`~*_=\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (content && content.length > 8) {
        speech.push(content);
      }
      continue;
    }

    // —— 表格段：★ 前面加"下面是表格"引导语，再逐行口语化
    if (lines.some((l) => /^\|/.test(l) && /\|/.test(l))) {
      const cells = lines
        .filter((l) => /^\|/.test(l))
        .filter((l) => !/^\|?[\s:-]*-{3,}/.test(l))
        .map((l) =>
          l
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => cleanInline(c).replace(/[#|>`~*_=\-]/g, "").trim())
            .filter(Boolean),
        );
      if (cells.length >= 2 && cells[0].length > 0) {
        const headers = cells[0];
        const rows = cells.slice(1).slice(0, 6);
        // ★ 引导语：让听者知道接下来是表格
        speech.push(`下面是表格，共${rows.length}行。`);
        const rowSpeech = rows
          .map((row) => headers.map((h, i) => `${h}：${row[i] || "无"}`).join("，"))
          .join("。");
        speech.push(rowSpeech + "。");
      }
      continue;
    }

    // —— 列表段：★ 前面加"分几点"引导语
    const isList = lines.every((l) => /^(\d+\.|[-*+])\s+/.test(l));
    if (isList && lines.length >= 2) {
      speech.push(`下面分${cnNum(lines.length)}点。`);
      const items = lines.map((l, i) => {
        const content = cleanInline(l.replace(/^(\s*)(\d+\.\s+|[-*+]\s+)/, ""))
          .replace(/[#|>`~*_=\-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return `第${cnNum(i + 1)}，${content}`;
      });
      speech.push(items.join("。") + "。");
      continue;
    }

    // —— 普通正文段
    const prose = lines
      .map((l) => cleanInline(l.replace(/^(\s*)(\d+\.\s+|[-*+]\s+)/, "")))
      .join(" ")
      .replace(/[#|>`~*_=\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (prose) {
      speech.push(prose);
    }
  }

  let out = speech.join("\n");
  out = out
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/^[ \t]+/gm, "")
    .trim();
  return out;
}

// ===================== 全局单例 TTS store =====================
// 关键设计：所有组件（ChatWindow / MessageView / FileViewer）共享同一个 TTS 实例。
// 这样自动朗读（ChatWindow 触发）和手动喇叭（MessageView）用的是同一份 speak
// 和 speakingId 状态，彻底解决「自动触发挂错组件、状态不互通」的问题。

type TTSState = {
  speakingId: string | null;
  loading: boolean;
  error: string | null;
};

let state: TTSState = { speakingId: null, loading: false, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<TTSState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot() {
  return state;
}

// 模块级播放资源（全局唯一）
let audioEl: HTMLAudioElement | null = null;
let queue: Array<{ url: string }> = [];
let playing = false;
let stopped = true;
let currentId: string | null = null;
let abortCtl: AbortController | null = null;
// 语速：edge-tts 格式，+15% 表示快 15%。0% 是正常，+30% 较快。
let ttsRate = "+15%";

function setTTSRate(r: string) {
  ttsRate = r;
  try { localStorage.setItem("pi-tts-rate", r); } catch { /* ignore */ }
}

function revokeAll() {
  queue.forEach((q) => URL.revokeObjectURL(q.url));
  queue = [];
}

function stopAll() {
  stopped = true;
  if (audioEl) {
    audioEl.pause();
    audioEl = null;
  }
  abortCtl?.abort();
  abortCtl = null;
  revokeAll();
  playing = false;
  setState({ speakingId: null, loading: false });
  currentId = null;
}

function playNext() {
  if (stopped) return;
  if (playing) return;
  const next = queue.shift();
  if (!next) {
    playing = false;
    setState({ speakingId: null });
    currentId = null;
    return;
  }
  playing = true;
  const audio = new Audio(next.url);
  audioEl = audio;
  audio.onended = () => {
    URL.revokeObjectURL(next.url);
    audioEl = null;
    playing = false;
    playNext();
  };
  audio.onerror = () => {
    console.error("[TTS] 段落播放失败");
    URL.revokeObjectURL(next.url);
    audioEl = null;
    playing = false;
    playNext();
  };
  audio.play().catch((e) => {
    console.error("[TTS] play() 被拒绝", e?.name, e?.message);
    setState({
      error: `无法自动播放：${e?.name === "NotAllowedError" ? "需点击页面后才能发声" : e?.message || "未知错误"}`,
      speakingId: null,
    });
    playing = false;
    currentId = null;
  });
}

function speakText(rawText: string, id?: string) {
  const speechId = id ?? "unknown";
  // 同一个正在朗读 → 停止
  if (currentId === speechId && (audioEl || state.loading || queue.length)) {
    stopAll();
    return;
  }
  const text = buildSpeechScript(rawText);
  if (!text) {
    setState({ error: "没有可朗读的内容" });
    return;
  }
  setState({ error: null });
  stopAll();

  currentId = speechId;
  stopped = false;
  queue = [];
  playing = false;
  setState({ speakingId: speechId, loading: true });

  const controller = new AbortController();
  abortCtl = controller;
  const startedAt = Date.now();

  fetch("/api/tts/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, rate: ttsRate }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(`TTS 接口返回 ${res.status}${detail ? `: ${detail.slice(0, 100)}` : ""}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let firstChunkAt = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            if (obj.done) {
              setState({ loading: false });
              continue;
            }
            if (obj.error) {
              console.warn("[TTS stream] 段落失败", obj.error);
              continue;
            }
            if (obj.audio) {
              if (!firstChunkAt) {
                firstChunkAt = Date.now() - startedAt;
                console.log(`[TTS] 首段 ${firstChunkAt}ms（共 ${obj.total} 段）`);
              }
              const bstr = atob(obj.audio);
              const bytes = new Uint8Array(bstr.length);
              for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i);
              const blob = new Blob([bytes], { type: "audio/mpeg" });
              const url = URL.createObjectURL(blob);
              queue.push({ url });
              playNext();
            }
          } catch {
            // ignore parse error
          }
        }
      }
    })
    .catch((e) => {
      if (e?.name === "AbortError") return;
      console.error("[TTS] stream 失败", e?.message);
      setState({ error: `朗读失败：${e?.message || "网络错误"}`, speakingId: null });
      currentId = null;
    })
    .finally(() => setState({ loading: false }));
}

// React hook：用 useSyncExternalStore 订阅全局 store
// 自动朗读的触发与开关都在 useAgentSession（agent_end）+ pi-sound-enabled，
// hook 这里只提供 speak/stop/状态给 UI（消息底部喇叭按钮、错误提示）。
export function useTTS() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const speak = useCallback((rawText: string, id?: string) => speakText(rawText, id), []);
  const stop = useCallback(() => stopAll(), []);
  const setError = useCallback((e: string | null) => setState({ error: e }), []);
  const setRate = useCallback((r: string) => setTTSRate(r), []);

  // 启动时读取已存语速（useEffect 只跑一次，在 hook 内）
  useEffect(() => {
    try {
      const r = localStorage.getItem("pi-tts-rate");
      if (r) setTTSRate(r);
    } catch { /* ignore */ }
  }, []);

  return {
    speak,
    stop,
    speakingId: snap.speakingId,
    loading: snap.loading,
    error: snap.error,
    setError,
    rate: ttsRate,
    setRate,
  };
}

// 导出全局触发函数：供非 hook 场景（agent_end 后自动朗读）直接调用
export const ttsSpeak = speakText;
export const ttsStop = stopAll;
