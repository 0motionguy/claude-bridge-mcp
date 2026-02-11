import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execSync } from "node:child_process";
import { executeClaudeCLI } from "./executor.js";
import { config } from "./config.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "claude_execute",
    description:
      "Execute a task using Claude Code on the remote PC. Spawns Claude CLI with full coding capabilities (read/write files, run commands, git ops). Returns structured JSON output.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The task for Claude Code to execute",
        },
        workingDirectory: {
          type: "string",
          description:
            "Working directory on the PC (must be in allowed list). Defaults to primary project.",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "claude_query",
    description:
      "Ask Claude Code a question without making changes. Read-only, fast. Good for code analysis, explanations, or quick lookups.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Question to ask Claude Code",
        },
        workingDirectory: {
          type: "string",
          description: "Working directory for context",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "claude_read_file",
    description:
      "Read a file from the PC filesystem. Returns the file contents as text.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the file on the PC",
        },
        encoding: {
          type: "string",
          description: 'File encoding (default: "utf-8")',
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "claude_git_status",
    description:
      "Get git status of a repository on the PC. Returns branch, staged/unstaged changes, and recent commits.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: {
          type: "string",
          description: "Path to the git repository on the PC",
        },
      },
      required: ["repoPath"],
    },
  },
];

function isPathAllowed(filePath: string): boolean {
  const normalized = resolve(filePath);
  return config.allowedDirectories.some((allowed) => {
    const allowedResolved = resolve(allowed);
    if (process.platform === "win32") {
      return normalized.toLowerCase().startsWith(allowedResolved.toLowerCase());
    }
    return (
      normalized === allowedResolved ||
      normalized.startsWith(allowedResolved + sep)
    );
  });
}

async function isRealPathAllowed(filePath: string): Promise<boolean> {
  try {
    const resolved = await realpath(filePath);
    return isPathAllowed(resolved);
  } catch {
    return isPathAllowed(filePath);
  }
}

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    let result: unknown;

    switch (name) {
      case "claude_execute": {
        const res = await executeClaudeCLI(args.prompt as string, {
          workingDirectory: args.workingDirectory as string | undefined,
          timeout: args.timeout as number | undefined,
        });
        result = res;
        break;
      }

      case "claude_query": {
        const res = await executeClaudeCLI(args.prompt as string, {
          workingDirectory: args.workingDirectory as string | undefined,
          printOnly: true,
          timeout: 60_000,
        });
        result = res;
        break;
      }

      case "claude_read_file": {
        const filePath = args.filePath as string;
        if (!(await isRealPathAllowed(filePath))) {
          throw new Error(`Path not allowed: ${filePath}`);
        }
        const encoding = (args.encoding as BufferEncoding) ?? "utf-8";
        const content = await readFile(filePath, { encoding });
        result = { content, path: filePath, size: content.length };
        break;
      }

      case "claude_git_status": {
        const repoPath = args.repoPath as string;
        if (!(await isRealPathAllowed(repoPath))) {
          throw new Error(`Path not allowed: ${repoPath}`);
        }
        const status = execSync("git status --porcelain", {
          cwd: repoPath,
          encoding: "utf-8",
        });
        const branch = execSync("git branch --show-current", {
          cwd: repoPath,
          encoding: "utf-8",
        }).trim();
        const log = execSync('git log --oneline -5 --format="%h %s"', {
          cwd: repoPath,
          encoding: "utf-8",
        });
        result = {
          branch,
          status: status || "(clean)",
          recentCommits: log.trim().split("\n"),
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}
