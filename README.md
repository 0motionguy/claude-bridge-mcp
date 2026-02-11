# claude-bridge-mcp

**Use your Claude Code MAX/PRO subscription from anywhere.**

An MCP server that exposes your local Claude Code CLI over HTTP+SSE, so any MCP-compatible client — [OpenClaw](https://openclaw.dev), Claude Desktop, or your own agents — can use your Claude Code subscription remotely.

```
Your PC (Claude MAX/PRO)              Remote Machine
┌──────────────────────┐              ┌──────────────────┐
│  claude-bridge-mcp   │◄────────────►│  OpenClaw Agent  │
│  :3100/sse           │   HTTP+SSE   │  Claude Desktop  │
│                      │   (Tailscale │  Custom MCP app  │
│  Spawns Claude CLI ──┤    or VPN)   └──────────────────┘
│  Uses YOUR sub  ─────┤
└──────────────────────┘

Your $100/mo MAX or $200/mo PRO → accessible from any machine
```

## Quick Start

**Prerequisites:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated on your machine.

```bash
# Run directly (no install needed)
npx claude-bridge-mcp

# Or install globally
npm install -g claude-bridge-mcp
claude-bridge-mcp
```

The server starts on `http://0.0.0.0:3100`. Verify:

```bash
curl http://localhost:3100/health
```

## Connect from OpenClaw

Add the bridge as an MCP server in your `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "claude-bridge": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://<your-pc-ip>:3100/sse"]
    }
  }
}
```

Replace `<your-pc-ip>` with your PC's IP address. If using [Tailscale](https://tailscale.com), use your Tailscale IP (`tailscale ip -4`).

Now your OpenClaw agent can use `claude_execute`, `claude_query`, `claude_read_file`, and `claude_git_status` — all powered by your Claude Code subscription.

## Connect from Claude Desktop

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-bridge": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://<your-pc-ip>:3100/sse"]
    }
  }
}
```

## Available Tools

| Tool                | Description                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `claude_execute`    | Execute a task using Claude Code. Full coding capabilities: read/write files, run commands, git operations. |
| `claude_query`      | Ask Claude Code a question (read-only, fast). Great for code analysis and explanations.                     |
| `claude_read_file`  | Read a file from the PC filesystem.                                                                         |
| `claude_git_status` | Get git status: branch, changes, and recent commits.                                                        |

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable                | Default         | Description                                                                                                                     |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGE_HOST`           | `0.0.0.0`       | Bind address                                                                                                                    |
| `BRIDGE_PORT`           | `3100`          | Server port                                                                                                                     |
| `BRIDGE_API_TOKEN`      | _(none)_        | Bearer token for authentication. If set, all requests (except `/health` and `/metrics`) require `Authorization: Bearer <token>` |
| `BRIDGE_ALLOWED_IPS`    | _(empty = all)_ | Comma-separated IP allowlist. Empty means all IPs allowed. Localhost is always allowed.                                         |
| `BRIDGE_ALLOWED_DIRS`   | _(empty = cwd)_ | Comma-separated directory allowlist. Empty defaults to the current working directory.                                           |
| `BRIDGE_TIMEOUT`        | `120000`        | Execution timeout in ms                                                                                                         |
| `BRIDGE_MAX_CONCURRENT` | `2`             | Max concurrent Claude CLI executions                                                                                            |
| `BRIDGE_QUEUE_TIMEOUT`  | `30000`         | Queue wait timeout in ms                                                                                                        |

## Security

The bridge includes multiple security layers:

- **IP Allowlist** — Restrict access to specific IPs (e.g., your Tailscale network). Localhost always allowed.
- **Bearer Token Auth** — Set `BRIDGE_API_TOKEN` for token-based authentication.
- **Directory Allowlist** — Claude CLI can only access directories you explicitly allow.
- **Symlink Protection** — Paths are resolved via `realpath()` before checking the allowlist, preventing symlink traversal.
- **Execution Queue** — FIFO queue with configurable concurrency limits and timeout to prevent resource exhaustion.

**Recommended setup for remote access:**

```bash
# Use Tailscale for encrypted networking
BRIDGE_ALLOWED_IPS=100.x.y.z    # Your remote machine's Tailscale IP
BRIDGE_API_TOKEN=your-secret     # Additional auth layer
BRIDGE_ALLOWED_DIRS=/path/to/project1,/path/to/project2
```

## Endpoints

| Endpoint    | Method | Description                       |
| ----------- | ------ | --------------------------------- |
| `/sse`      | GET    | SSE connection for MCP clients    |
| `/messages` | POST   | JSON-RPC message endpoint         |
| `/health`   | GET    | Health check (no auth required)   |
| `/metrics`  | GET    | Server metrics (no auth required) |

## How It Works

1. Remote MCP client connects to `/sse` (Server-Sent Events)
2. Client sends tool calls via `/messages` (JSON-RPC over HTTP)
3. Bridge spawns `claude` CLI locally with your authenticated session
4. Results stream back over SSE

The bridge uses the [Model Context Protocol](https://modelcontextprotocol.io/) — the open standard for AI tool communication.

## Supported Platforms

Runs anywhere Claude Code CLI and Node.js are available:

| Platform                                | Notes                                |
| --------------------------------------- | ------------------------------------ |
| **Windows** 10/11                       | Full support                         |
| **macOS** (Intel & Apple Silicon)       | Full support                         |
| **Linux** (Ubuntu, Debian, etc.)        | Full support                         |
| **Linux VPS** (AWS, DigitalOcean, etc.) | Run the bridge on any cloud VM       |
| **Docker**                              | `node:18-alpine` or similar          |
| **Mac Mini** (headless server)          | Great as an always-on bridge         |
| **Termux** (Android)                    | Set `BRIDGE_ALLOWED_DIRS` explicitly |
| **WSL2**                                | Full support                         |

**Same-machine use:** The bridge also works locally — useful for apps that only speak MCP but need Claude Code capabilities. Just connect to `http://localhost:3100/sse`.

## Requirements

- **Node.js** 18+
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)
- An active **Claude Code MAX** ($100/mo) or **PRO** ($200/mo) subscription

## Development

```bash
git clone https://github.com/0motionguy/claude-bridge-mcp.git
cd claude-bridge-mcp
npm install
npm run dev    # Hot-reload development server
npm run build  # Production build
```

## License

MIT - see [LICENSE](LICENSE)

---

Built by [ICM Motion](https://gicm.app) for the [OpenClaw](https://openclaw.dev) community.
