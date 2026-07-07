// pi-web 代理初始化脚本 - 在 Next.js 子进程中加载
//
// 路由策略：
//   • DeepSeek（api.deepseek.com）—— 永远直连，不走代理，也不做代理探测
//   • 其它主机 —— 维持原有 SOCKS5 代理（sing-box :10090）行为
//
// 实现方式：自定义 dispatcher，在 dispatch 阶段按目标主机分流到直连 Agent
// 或 Socks5ProxyAgent。DeepSeek 直连由独立的 Agent 实例保证，与代理是否
// 可用完全无关。
const SOCKS5_URL = "socks5://127.0.0.1:10090";

// 永远直连的主机（小写匹配）。DeepSeek 本机直连即可，无需也不应走代理。
const DIRECT_HOSTS = new Set([
  "api.deepseek.com",
]);

const undiciPath =
  "/Users/Ai/server/pi-web/node_modules/@earendil-works/pi-coding-agent/node_modules/undici";

try {
  const undici = require(undiciPath);

  // 直连 dispatcher —— 复用全局默认（未配置代理时的直连 Agent），
  // 这样连接池/keep-alive 等行为与正常直连一致。
  const directAgent = undici.getGlobalDispatcher();

  // 代理 dispatcher —— 仅用于非 DeepSeek 主机。
  // 若 sing-box 未运行，这些主机的请求会照常失败，但不会波及 DeepSeek。
  let proxyAgent;
  try {
    proxyAgent = new undici.Socks5ProxyAgent(SOCKS5_URL);
    console.log(`[proxy-bootstrap] Non-direct hosts will use SOCKS5 ${SOCKS5_URL}`);
  } catch (e) {
    console.warn(`[proxy-bootstrap] Socks5ProxyAgent unavailable: ${e.message}`);
  }

  // 自定义 dispatcher：按主机分流
  const routingDispatcher = {
    dispatch(opts, handler) {
      const host = (opts.origin && (opts.origin.host || (typeof opts.origin === "string" ? opts.origin : ""))) || "";
      const hostname = String(host).toLowerCase().replace(/^https?:\/\//, "");
      const useDirect = DIRECT_HOSTS.has(hostname);
      const dispatcher = useDirect ? directAgent : (proxyAgent || directAgent);
      return dispatcher.dispatch(opts, handler);
    },
    // 透连 Agent 上可能存在的辅助方法（部分 undici API 会探测）
    close(...a) { return directAgent.close(...a); },
    destroy(...a) { return directAgent.destroy(...a); },
  };

  undici.setGlobalDispatcher(routingDispatcher);
  console.log(`[proxy-bootstrap] Routing active. Direct hosts: ${[...DIRECT_HOSTS].join(", ")}`);
} catch (e) {
  console.warn("[proxy-bootstrap] Failed:", e.message, "— using default direct connection.");
}
