# claude-bridge-mcp

Reach the Claude Code CLI on one machine from MCP clients on another.

claude-bridge-mcp is a small MCP server that runs next to an authenticated `claude` CLI and exposes it over HTTP with server-sent events (SSE). A remote MCP client connects to `/sse`, calls a tool, and the bridge spawns `claude` locally and returns the JSON result. It is for a developer who wants their own agents or MCP clients on other machines (a laptop, a VPS, a home server) to reach the Claude Code install on their main machine over a private network.

The bridge drives the official CLI under your own login. What a Claude plan allows is set by Anthropic's terms, so check them before you give other people or services access to a bridge.

## What it does

- **`claude_execute`** runs a prompt through `claude --print --output-format json` in an allowed working directory. Default timeout 120 s, overridable per call.
- **`claude_query`** is the same call with a 60 s limit and `--verbose`, meant for questions. Read-only is not enforced by the bridge; what the CLI may do is decided by your local Claude Code permission settings.
- **`claude_read_file`** reads a text file inside the directory allowlist. Paths go through `realpath` first, so a symlink cannot point outside the allowlist.
- **`claude_git_status`** returns the branch, `git status --porcelain` and the last five commits of a repository inside the allowlist.
- **Access control:** optional bearer token (constant-time compare), IP allowlist (localhost always passes), directory allowlist, and at most 5 SSE connections per IP.
- **Load control:** FIFO queue with configurable concurrency (default 2), queue depth capped at 50, queue timeout, a 100,000-character prompt limit, and output capture that stops at about 1 MB per stream.
- **Observability:** one log line per request and tool call, `GET /health` (no auth) and `GET /metrics`.

## How it's built

```
MCP client --GET /sse, POST /messages--> Express 4 + MCP SDK (SSE transport)
                                              |
                                              +-- tools.ts --> executor.ts --spawn--> claude CLI (local login)
```

TypeScript (ES modules), Express 4, `@modelcontextprotocol/sdk` and zod for config. Four source files, about 630 lines. There is no test suite in the repo.

## Repository layout

- `src/index.ts`: HTTP server, auth and IP middleware, SSE and message routes, health and metrics.
- `src/tools.ts`: the four tool definitions and handlers.
- `src/executor.ts`: CLI spawn, queue, timeouts, working-directory check.
- `src/config.ts`: environment parsing and defaults.
- `smithery.json`: marketplace listing.
- `.env.example`: configuration template.

## Run it locally

Needs Node 18+ and the `claude` CLI on `PATH`, already logged in.

```bash
git clone https://github.com/0motionguy/claude-bridge-mcp.git
cd claude-bridge-mcp
npm install
npm run build && npm start        # or `npm run dev` for watch mode
curl http://localhost:3100/health
```

Point an MCP client at it with `npx -y mcp-remote http://<host>:3100/sse`.

The server reads plain environment variables and does not load `.env` itself. Export them, or on Node 20.6+ start it with `node --env-file=.env dist/index.js`.

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_HOST` | `0.0.0.0` | Bind address |
| `BRIDGE_PORT` | `3100` | Port |
| `BRIDGE_API_TOKEN` | unset | If set, every route except `/health` needs `Authorization: Bearer <token>` |
| `BRIDGE_ALLOWED_IPS` | empty (all) | Comma-separated client IPs; localhost is always allowed |
| `BRIDGE_ALLOWED_DIRS` | empty (cwd) | Comma-separated directories the tools may use |
| `BRIDGE_TIMEOUT` | `120000` | Execution timeout in ms |
| `BRIDGE_MAX_CONCURRENT` | `2` | Parallel `claude` runs |
| `BRIDGE_QUEUE_TIMEOUT` | `30000` | Max wait in the queue in ms |

The defaults are open: the server binds all interfaces and the token is optional. Before exposing it beyond localhost, set `BRIDGE_API_TOKEN` and `BRIDGE_ALLOWED_IPS` and bind to a private interface. The directory allowlist covers the working directory and the two file tools; it does not sandbox the spawned CLI.

## Status

Beta. A single-purpose tool at version 1.1.0 with five commits, last push 2026-02-17. It is not released from this repository to npm: the `claude-bridge-mcp` name on the npm registry belongs to an unrelated project, so install from a clone.

Licence: MIT, see `LICENSE`.
