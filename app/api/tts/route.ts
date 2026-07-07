import { NextRequest, NextResponse } from "next/server";

// TTS 接口：用微软 Edge TTS（晓晓 zh-CN-XiaoxiaoNeural）生成自然女声
// 声音接近真人，远优于浏览器原生和系统 Tingting
// 通过 python edge-tts 调用，返回 mp3 音频

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// python3 edge-tts 的路径（pip 装在用户目录）
const PY_BIN = "/usr/bin/python3";
const PY_PATH = "/Users/Ai/Library/Python/3.9/bin";

export async function POST(req: NextRequest) {
  try {
    const { text, voice, rate } = (await req.json()) as {
      text: string;
      voice?: string;
      rate?: string;
    };
    if (!text || !text.trim()) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    // 截断超长文本（edge-tts 处理过长会慢），最多 4000 字
    const cleanText = text.slice(0, 4000);

    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const { writeFile, readFile, unlink, mkdtemp } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const execFileAsync = promisify(execFile);

    // 选声音：中文用晓晓（最自然），英文用 Ava
    const voiceName =
      voice || (/[\u4e00-\u9fff]/.test(cleanText) ? "zh-CN-XiaoxiaoNeural" : "en-US-AvaMultilingualNeural");
    const rateStr = rate || "+0%";

    // 创建临时文件
    const tmpDir = await mkdtemp(join(tmpdir(), "pi-tts-"));
    const txtPath = join(tmpDir, "input.txt");
    const audioPath = join(tmpDir, "output.mp3");

    // 写入文本（避免命令行参数转义和长度限制）
    await writeFile(txtPath, cleanText, "utf8");

    // 用 python -m edge_tts 生成 mp3（PATH 加上 pip 脚本目录）
    // edge_tts 从文件读取用 --file（新版支持），旧版用 stdin
    try {
      await execFileAsync(
        PY_BIN,
        ["-m", "edge_tts", "--voice", voiceName, "--rate", rateStr, "-f", txtPath, "--write-media", audioPath],
        { timeout: 45_000, env: { ...process.env, PATH: `${PY_PATH}:${process.env.PATH}` } },
      );
    } catch {
      // 旧版 edge_tts 不支持 -f，回退用 --text 参数（注意长度）
      const shortText = cleanText.slice(0, 800);
      await execFileAsync(
        PY_BIN,
        ["-m", "edge_tts", "--voice", voiceName, "--rate", rateStr, "--text", shortText, "--write-media", audioPath],
        { timeout: 45_000, env: { ...process.env, PATH: `${PY_PATH}:${process.env.PATH}` } },
      );
    }

    // 读取音频文件
    const audioBuffer = await readFile(audioPath);

    // 清理临时文件
    await unlink(txtPath).catch(() => {});
    await unlink(audioPath).catch(() => {});

    // 返回 mp3 音频（浏览器兼容性最好）
    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.length),
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
