import { NextRequest } from "next/server";

// 分段流式 TTS：把文本按句切分，逐段生成 mp3，以 NDJSON 流式返回。
// 每行一个 JSON：{i, audio(base64), done}。前端拿到第一段即可播放，
// 显著降低首字延迟（从 ~10s 降到 ~2s），后续段落边生成边接续播放。
//
// 格式选择 NDJSON（而非 multipart）：浏览器 fetch + ReadableStream 解析简单可靠。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PY_BIN = "/usr/bin/python3";
const PY_PATH = "/Users/Ai/Library/Python/3.9/bin";

// 把文本切成「适合 TTS」的小段。
// 关键：第一段要短（≤50字），让首字延迟最低（~1.5s 出声）；后续段稍长（≤90字）效率更高。
// 按句号/问号/感叹号/换行切，超长段按逗号硬切。
function splitForTTS(text: string): string[] {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const sentences = raw.split(/(?<=[。．！？!?\n])\s*/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  let isFirst = true;
  const maxLen = () => (isFirst ? 50 : 90);
  const flush = () => {
    if (buf.trim()) {
      chunks.push(buf.trim());
      isFirst = false;
    }
    buf = "";
  };
  for (const seg of sentences) {
    if (seg.length > 90) {
      // 单句过长 → 按逗号切
      flush();
      const sub = seg.split(/(?<=[,，])/);
      let sb = "";
      for (const x of sub) {
        if ((sb + x).length > maxLen()) {
          if (sb) chunks.push(sb.trim()), (isFirst = false);
          sb = x;
        } else {
          sb += x;
        }
      }
      if (sb.trim()) chunks.push(sb.trim()), (isFirst = false);
      continue;
    }
    if ((buf + seg).length > maxLen()) {
      flush();
      buf = seg;
    } else {
      buf += seg;
    }
  }
  flush();
  // 合并过短碎片到前一段
  const merged: string[] = [];
  for (const c of chunks) {
    if (c.length < 6 && merged.length) merged[merged.length - 1] += c;
    else merged.push(c);
  }
  return merged.length ? merged : [raw.slice(0, 50)];
}

async function synthChunk(text: string, voiceName: string, rateStr: string): Promise<Buffer> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { writeFile, readFile, unlink, mkdtemp } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const execFileAsync = promisify(execFile);

  const tmpDir = await mkdtemp(join(tmpdir(), "pi-tts-"));
  const txtPath = join(tmpDir, "in.txt");
  const audioPath = join(tmpDir, "out.mp3");
  await writeFile(txtPath, text, "utf8");
  try {
    await execFileAsync(
      PY_BIN,
      ["-m", "edge_tts", "--voice", voiceName, "--rate", rateStr, "-f", txtPath, "--write-media", audioPath],
      { timeout: 30_000, env: { ...process.env, PATH: `${PY_PATH}:${process.env.PATH}` } },
    );
  } catch {
    await execFileAsync(
      PY_BIN,
      ["-m", "edge_tts", "--voice", voiceName, "--rate", rateStr, "--text", text.slice(0, 400), "--write-media", audioPath],
      { timeout: 30_000, env: { ...process.env, PATH: `${PY_PATH}:${process.env.PATH}` } },
    );
  }
  const buf = await readFile(audioPath);
  await unlink(txtPath).catch(() => {});
  await unlink(audioPath).catch(() => {});
  return buf;
}

export async function POST(req: NextRequest) {
  try {
    const { text, voice, rate } = (await req.json()) as { text: string; voice?: string; rate?: string };
    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const cleanText = text.slice(0, 4000);
    const chunks = splitForTTS(cleanText);
    const voiceName = voice || (/[\u4e00-\u9fff]/.test(cleanText) ? "zh-CN-XiaoxiaoNeural" : "en-US-AvaMultilingualNeural");
    const rateStr = rate || "+0%";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < chunks.length; i++) {
          try {
            const buf = await synthChunk(chunks[i], voiceName, rateStr);
            const b64 = buf.toString("base64");
            controller.enqueue(encoder.encode(JSON.stringify({ i, total: chunks.length, audio: b64 }) + "\n"));
          } catch (e) {
            controller.enqueue(encoder.encode(JSON.stringify({ i, total: chunks.length, error: e instanceof Error ? e.message : "synth failed" }) + "\n"));
          }
        }
        controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + "\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no", // 禁用代理缓冲，确保流式
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TTS stream failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
