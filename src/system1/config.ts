export type TransportMode = "stdio" | "http";

export interface Config {
  transport: TransportMode;
  host: string;
  port: number;
  modelDir?: string;
  cacheDir?: string;
  repo?: string;
  subfolder?: string;
  revision?: string;
  executionProviders: string[];
  timeoutMs: number;
  preload: boolean;
  maxStateBytes: number;
  maxQuestions: number;
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function intValue(raw: string | undefined, fallback: number, minimum: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`invalid integer: ${raw}`);
  }
  return value;
}

function boolValue(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    throw new UsageError();
  }

  const transport: TransportMode = hasFlag(argv, "--http")
    ? "http"
    : hasFlag(argv, "--stdio")
      ? "stdio"
      : env.SYSTEM1_MCP_TRANSPORT === "http"
        ? "http"
        : "stdio";

  const providers = (argValue(argv, "--execution-providers")
    ?? env.LAYA_EXECUTION_PROVIDERS
    ?? "cpu")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    transport,
    host: argValue(argv, "--host") ?? env.SYSTEM1_MCP_HOST ?? "127.0.0.1",
    port: intValue(argValue(argv, "--port") ?? env.SYSTEM1_MCP_PORT, 8767, 1),
    modelDir: argValue(argv, "--model-dir") ?? env.LAYA_MODEL_DIR,
    cacheDir: argValue(argv, "--cache-dir") ?? env.LAYA_CACHE,
    repo: argValue(argv, "--repo") ?? env.LAYA_REPO,
    subfolder: argValue(argv, "--subfolder") ?? env.LAYA_SUBFOLDER,
    revision: argValue(argv, "--revision") ?? env.LAYA_REVISION,
    executionProviders: providers.length ? providers : ["cpu"],
    timeoutMs: intValue(argValue(argv, "--timeout-ms") ?? env.LAYA_TIMEOUT_MS, 2000, 1),
    preload: hasFlag(argv, "--preload") || boolValue(env.LAYA_PRELOAD, false),
    maxStateBytes: intValue(env.LAYA_MAX_STATE_BYTES, 256 * 1024, 1),
    maxQuestions: intValue(env.LAYA_MAX_QUESTIONS, 64, 1),
  };
}

export class UsageError extends Error {
  constructor() {
    super(usage());
  }
}

export function usage(): string {
  return `roboparty-system1-mcp — Laya System-1 decision analysis over MCP

Usage:
  roboparty-system1-mcp [--stdio] [options]
  roboparty-system1-mcp --http [--host 127.0.0.1] [--port 8767] [options]

Options:
  --stdio                         MCP over stdio (default)
  --http                          MCP Streamable HTTP + REST endpoints
  --host HOST                     HTTP bind address (default 127.0.0.1)
  --port PORT                     HTTP port (default 8767)
  --model-dir DIR                 Local ONNX bundle (skips download)
  --cache-dir DIR                 Model cache (default package cache)
  --repo REPO                     Hugging Face repo (default receptron/laya-onnx)
  --subfolder DIR                 Checkpoint subfolder
  --revision REV                  Model revision
  --execution-providers LIST      Comma-separated ORT providers (default cpu)
  --timeout-ms MS                 Per-analysis timeout (default 2000)
  --preload                       Load the model in the background at startup
  -h, --help                      Show this help

Environment:
  LAYA_MODEL_DIR, LAYA_CACHE, LAYA_REPO, LAYA_SUBFOLDER, LAYA_REVISION,
  LAYA_EXECUTION_PROVIDERS, LAYA_TIMEOUT_MS, LAYA_PRELOAD,
  LAYA_MAX_STATE_BYTES, LAYA_MAX_QUESTIONS, SYSTEM1_MCP_HOST, SYSTEM1_MCP_PORT
`;
}
