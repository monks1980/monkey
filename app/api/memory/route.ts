import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { homedir } from "os";

// 记忆/约束文件管理接口
// 管理 PI 在各工作目录的 AGENTS.md（PI 自动读取的约束文件）
// 以及全局的 ~/.pi/agent/AGENTS.md（如果存在）

const CANDIDATE_NAMES = ["AGENTS.md", "CLAUDE.md", "MEMORY.md"];

/** 在给定 cwd 下查找已存在的记忆文件 */
function findMemoryFile(cwd: string): string | null {
  for (const name of CANDIDATE_NAMES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  // 安全：cwd 必须存在且是目录
  let resolvedCwd: string;
  try {
    resolvedCwd = path.resolve(cwd.replace(/^~/, homedir()));
    if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
      return NextResponse.json({ error: "cwd not found" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "invalid cwd" }, { status: 400 });
  }

  // 查找已存在的记忆文件
  const existing = findMemoryFile(resolvedCwd);
  const filePath = existing ?? path.join(resolvedCwd, "AGENTS.md");

  let content = "";
  let exists = false;
  if (existing && fs.existsSync(existing)) {
    try {
      content = fs.readFileSync(existing, "utf8");
      exists = true;
    } catch {
      exists = false;
    }
  }

  // 全局记忆文件：PI 在 home 目录读取的工作区约束（所有项目共享）
  // 优先级：~/AGENTS.md > ~/MEMORY.md。这是 PI 全局行为的真正约束文件。
  const homeAgent = path.join(homedir(), "AGENTS.md");
  const homeMemory = path.join(homedir(), "MEMORY.md");
  const globalPath = fs.existsSync(homeAgent) ? homeAgent : fs.existsSync(homeMemory) ? homeMemory : homeAgent;
  let globalContent = "";
  let globalExists = false;
  if (fs.existsSync(globalPath)) {
    try {
      globalContent = fs.readFileSync(globalPath, "utf8");
      globalExists = true;
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    filePath,
    fileName: path.basename(filePath),
    content,
    exists,
    candidates: CANDIDATE_NAMES,
    global: {
      filePath: globalPath,
      content: globalContent,
      exists: globalExists,
    },
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { filePath, content } = body as { filePath: string; content: string };

    if (!filePath) {
      return NextResponse.json({ error: "filePath required" }, { status: 400 });
    }

    // 安全：只允许写 AGENTS.md / CLAUDE.md / MEMORY.md
    const baseName = path.basename(filePath);
    if (!CANDIDATE_NAMES.includes(baseName)) {
      return NextResponse.json(
        { error: `only ${CANDIDATE_NAMES.join(", ")} are allowed` },
        { status: 403 },
      );
    }

    const resolved = path.resolve(filePath.replace(/^~/, homedir()));

    // 确保父目录存在
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf8");

    return NextResponse.json({ ok: true, filePath: resolved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
