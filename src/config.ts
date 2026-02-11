import { z } from "zod";
import { resolve } from "node:path";

const ConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().default(3100),
  apiToken: z.string().optional(),
  allowedIPs: z.array(z.string()).default([]),
  allowedDirectories: z.array(z.string()).default([]),
  executionTimeout: z.coerce.number().default(120_000),
  maxConcurrent: z.coerce.number().default(2),
  queueTimeout: z.coerce.number().default(30_000),
});

export type Config = z.infer<typeof ConfigSchema>;

const parsed = ConfigSchema.parse({
  host: process.env.BRIDGE_HOST,
  port: process.env.BRIDGE_PORT,
  apiToken: process.env.BRIDGE_API_TOKEN,
  allowedIPs: process.env.BRIDGE_ALLOWED_IPS?.split(",").filter(Boolean),
  allowedDirectories:
    process.env.BRIDGE_ALLOWED_DIRS?.split(",").filter(Boolean),
  executionTimeout: process.env.BRIDGE_TIMEOUT,
  maxConcurrent: process.env.BRIDGE_MAX_CONCURRENT,
  queueTimeout: process.env.BRIDGE_QUEUE_TIMEOUT,
});

// Auto-detect: if no directories configured, allow current working directory
if (parsed.allowedDirectories.length === 0) {
  parsed.allowedDirectories = [resolve(process.cwd())];
}

export const config: Config = parsed;
