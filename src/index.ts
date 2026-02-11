#!/usr/bin/env node
/**
 * claude-bridge-mcp
 *
 * Bidirectional MCP bridge — exposes Claude Code capabilities over HTTP+SSE
 * so remote agents (like OpenClaw) can execute tasks on this machine.
 *
 * Usage:
 *   npx claude-bridge-mcp
 *
 * Connect from remote MCP client:
 *   npx mcp-remote http://<this-machine-ip>:3100/sse
 */

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { toolDefinitions, handleTool } from "./tools.js";
import { config } from "./config.js";

// Verify Claude CLI is available at startup
try {
  execSync("claude --version", { stdio: "ignore", timeout: 5000 });
} catch {
  console.error("ERROR: 'claude' CLI not found in PATH.");
  console.error("Install: https://docs.anthropic.com/en/docs/claude-code");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "200kb" }));

// Track active SSE transports by session ID
const transports = new Map<string, SSEServerTransport>();

// SSE connection limit per IP
const MAX_SSE_PER_IP = 5;
const ssePerIP = new Map<string, number>();

// Metrics
const metrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalToolCalls: 0,
  errors: 0,
};

// Request logging
function logRequest(
  ip: string,
  method: string,
  path: string,
  status: number,
  durationMs?: number,
) {
  const ts = new Date().toISOString();
  const dur = durationMs != null ? ` ${durationMs}ms` : "";
  console.log(`[${ts}] ${method} ${path} ${status} ${ip}${dur}`);
}

// Timing-safe string comparison
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Bearer token auth middleware (if BRIDGE_API_TOKEN is set)
app.use((req, res, next) => {
  metrics.totalRequests++;

  if (!config.apiToken) return next();
  if (req.path === "/health") return next();

  const auth = req.headers.authorization;
  if (!auth || !timingSafeCompare(auth, `Bearer ${config.apiToken}`)) {
    logRequest(req.ip ?? "unknown", req.method, req.path, 401);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// IP allowlist middleware
app.use((req, res, next) => {
  const clientIP =
    req.ip?.replace("::ffff:", "") ?? req.socket.remoteAddress ?? "";
  const normalized = clientIP.replace("::ffff:", "");

  if (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  ) {
    return next();
  }

  if (config.allowedIPs.length > 0 && !config.allowedIPs.includes(normalized)) {
    logRequest(normalized, req.method, req.path, 403);
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "claude-bridge-mcp",
    version: "1.1.0",
  });
});

// Metrics endpoint
app.get("/metrics", (_req, res) => {
  res.json({
    uptimeMs: Date.now() - metrics.startedAt,
    totalRequests: metrics.totalRequests,
    totalToolCalls: metrics.totalToolCalls,
    errors: metrics.errors,
    activeSessions: transports.size,
  });
});

// SSE endpoint — client connects here
app.get("/sse", async (req, res) => {
  const clientIP = req.ip?.replace("::ffff:", "") ?? "unknown";
  const count = ssePerIP.get(clientIP) ?? 0;

  if (count >= MAX_SSE_PER_IP) {
    logRequest(clientIP, "GET", "/sse", 429);
    return res.status(429).json({ error: "Too many connections" });
  }

  ssePerIP.set(clientIP, count + 1);
  logRequest(clientIP, "GET", "/sse", 200);

  const mcpServer = new Server(
    { name: "claude-bridge", version: "1.1.0" },
    { capabilities: { tools: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const start = Date.now();
    metrics.totalToolCalls++;
    logRequest(clientIP, "TOOL", name, 200);
    try {
      const result = await handleTool(
        name,
        (args ?? {}) as Record<string, unknown>,
      );
      logRequest(clientIP, "TOOL_DONE", name, 200, Date.now() - start);
      return result;
    } catch (err) {
      metrics.errors++;
      logRequest(clientIP, "TOOL_ERR", name, 500, Date.now() - start);
      throw err;
    }
  });

  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  transport.onclose = () => {
    console.log(`SSE session ${transport.sessionId} closed`);
    transports.delete(transport.sessionId);
    ssePerIP.set(clientIP, (ssePerIP.get(clientIP) ?? 1) - 1);
  };

  await mcpServer.connect(transport);
});

// Message endpoint — client sends JSON-RPC messages here
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    return res.status(404).json({ error: "Session not found" });
  }

  await transport.handlePostMessage(req, res);
});

// Start server
app.listen(config.port, config.host, () => {
  const authStatus = config.apiToken ? "Bearer token" : "None (IP only)";
  console.log(`
╔══════════════════════════════════════════════╗
║       Claude Bridge MCP Server v1.1.0        ║
╠══════════════════════════════════════════════╣
║  SSE:     http://${config.host}:${config.port}/sse
║  Health:  http://${config.host}:${config.port}/health
║  Metrics: http://${config.host}:${config.port}/metrics
║  Tools:   ${toolDefinitions.length} available
║  Auth:    ${authStatus}
║  IPs:     ${config.allowedIPs.length > 0 ? config.allowedIPs.join(", ") : "all (no allowlist)"}
║  Dirs:    ${config.allowedDirectories.join(", ")}
╚══════════════════════════════════════════════╝
`);
});
