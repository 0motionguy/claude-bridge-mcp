import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { config } from "./config.js";

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
  durationMs: number;
}

const MAX_PROMPT_LENGTH = 100_000;
const MAX_OUTPUT = 1_000_000;
const MAX_QUEUE_DEPTH = 50;

let activeExecutions = 0;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> =
  [];

function isPathAllowed(dir: string): boolean {
  const normalized = resolve(dir);
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

function releaseSlot() {
  activeExecutions--;
  const next = waitQueue.shift();
  if (next) next.resolve();
}

async function acquireSlot(): Promise<void> {
  if (activeExecutions < config.maxConcurrent) {
    activeExecutions++;
    return;
  }

  if (waitQueue.length >= MAX_QUEUE_DEPTH) {
    throw new Error("Server overloaded");
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error("Queue timeout"));
    }, config.queueTimeout);

    waitQueue.push({
      resolve: () => {
        clearTimeout(timer);
        activeExecutions++;
        resolve();
      },
      reject,
    });
  });
}

export async function executeClaudeCLI(
  prompt: string,
  options: {
    workingDirectory?: string;
    timeout?: number;
    printOnly?: boolean;
  } = {},
): Promise<ExecutionResult> {
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      success: false,
      output: "",
      error: `Prompt too large (max ${MAX_PROMPT_LENGTH} chars)`,
      exitCode: null,
      durationMs: 0,
    };
  }

  try {
    await acquireSlot();
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : "Queue full",
      exitCode: null,
      durationMs: 0,
    };
  }

  const cwd = options.workingDirectory ?? config.allowedDirectories[0];
  if (!isPathAllowed(cwd)) {
    releaseSlot();
    return {
      success: false,
      output: "",
      error: "Directory not allowed",
      exitCode: null,
      durationMs: 0,
    };
  }

  const timeout = options.timeout ?? config.executionTimeout;
  const args = ["--print", "--output-format", "json"];
  if (options.printOnly) {
    args.push("--verbose");
  }
  args.push("-p", prompt);

  const start = Date.now();

  return new Promise<ExecutionResult>((resolve) => {
    const proc = spawn("claude", args, {
      cwd,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        success: false,
        output: stdout,
        error: `Execution timed out after ${timeout}ms`,
        exitCode: null,
        durationMs: Date.now() - start,
      });
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      releaseSlot();
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
        exitCode: code,
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      releaseSlot();
      resolve({
        success: false,
        output: "",
        error: `Failed to spawn claude: ${err.message}`,
        exitCode: null,
        durationMs: Date.now() - start,
      });
    });
  });
}
