/**
 * Standalone entry for Azure ACI browser worker.
 * Processes env BROWSER_AGENT_MODE=demo|live and keeps process alive for health.
 */
import { createProfileStoreFromEnv } from "./profileStore.js";
import { SessionPool } from "./sessionPool.js";
import { BrowserAgentRunner } from "./runner.js";
import { createServer } from "node:http";

const profiles = createProfileStoreFromEnv();
const pool = new SessionPool({ profiles });
const runner = new BrowserAgentRunner({ pool });

const port = Number(process.env.PORT || 8090);
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "amilo-browser-agent" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, () => {
  console.info(
    JSON.stringify({
      event: "browser_agent_listen",
      port,
      mode: process.env.BROWSER_AGENT_MODE || "demo",
    }),
  );
});

process.on("SIGTERM", () => {
  void pool.shutdown().then(() => process.exit(0));
});

export { runner, pool };
