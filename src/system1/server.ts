import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Question } from "@receptron/laya";
import type { Analyzer } from "./laya.js";
import type { Config } from "./config.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const instructions = z.union([z.string(), z.record(z.string(), z.unknown())]);
const choiceQuestion = z.object({
  type: z.literal("choice"),
  instructions,
  criteria: z.union([z.record(z.string(), z.string().nullable()), z.array(z.string())]),
});
const scoreQuestion = z.object({
  type: z.literal("score"),
  instructions,
  criteria: z.array(z.string()),
});
const noulQuestion = z.object({
  type: z.literal("noul"),
  instructions,
  criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional(),
});
const questionSchema = z.discriminatedUnion("type", [choiceQuestion, scoreQuestion, noulQuestion]);

const analyzeInput = {
  state: z.unknown().describe("Ticket, email, user message, or robot state to analyze."),
  questions: z.record(z.string(), questionSchema).describe("Named Laya questions: choice, score, or noul."),
};

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

export interface AnalyzeInput {
  state: unknown;
  questions: Record<string, Question>;
}

export const analyzeRequestSchema = z.object({
  state: z.unknown(),
  questions: z.record(z.string(), questionSchema),
});

export async function runAnalysis(
  analyzer: Analyzer,
  config: Config,
  state: unknown,
  questions: Record<string, Question>,
) {
  const count = Object.keys(questions).length;
  if (count === 0) throw new Error("at least one question is required");
  if (count > config.maxQuestions) {
    throw new Error(`too many questions: ${count} > ${config.maxQuestions}`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(state ?? null), "utf8");
  if (bytes > config.maxStateBytes) {
    throw new Error(`state is too large: ${bytes} > ${config.maxStateBytes} bytes`);
  }
  const { result, latencyMs } = await analyzer.analyze(state, questions);
  return { ...result, latency_ms: latencyMs };
}

export function createServer(analyzer: Analyzer, config: Config): McpServer {
  const server = new McpServer({
    name: "roboparty-system1-mcp",
    version: pkg.version,
  });

  server.registerTool(
    "laya_analyze",
    {
      title: "Laya System-1 analysis",
      description:
        "Run Laya once over a state and typed questions. Returns calibrated choice/score/noul answers with probabilities. Analysis only; it does not control the robot.",
      inputSchema: analyzeInput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ state, questions }) => {
      try {
        const payload = await runAnalysis(
          analyzer,
          config,
          state,
          questions as Record<string, Question>,
        );
        return {
          ...textResult(payload),
          structuredContent: payload as Record<string, unknown>,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult({ ok: false, error: message }, true);
      }
    },
  );

  server.registerTool(
    "laya_health",
    {
      title: "Laya health",
      description: "Return whether the Laya model is loaded, loading, or failed, plus last latency.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => textResult({ ok: true, ...analyzer.health() }),
  );

  server.registerTool(
    "laya_info",
    {
      title: "Laya model info",
      description: "Return Laya model path, source, execution providers and loaded config.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => textResult({ ok: true, ...analyzer.info() }),
  );

  return server;
}
