import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Lang } from "./types.js";
import { getPage, listManuals, listToc, searchDocs, warmSearchIndex } from "./service.js";

export const PACKAGE_VERSION = (() => {
  try {
    const manifest = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "roboparty-docs", version: PACKAGE_VERSION });

  server.registerTool(
    "list_manuals",
    {
      description:
        "列出可用资料：RoboParty 公开文档的产品、分类与页数，以及已索引的 RP1 GitHub 仓库/页数。回答机器人问题前先用它了解可用资料。",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(listManuals(await warmSearchIndex()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "search_docs",
    {
      description:
        "在 RoboParty 公开文档中检索：roboparty.com 文档全文 + RP1 各 GitHub 仓库的 README/docs（kind=github；私有仓库需 gh auth login）。传短查询：错误原文、命令、接口名、仓库名或几个关键词，不要贴整段话。默认按查询语言自动选择中文/英文并优先该语言。命中后用 get_page 打开 url，用原文回答并附链接。不要凭记忆编造管脚、包名、版本或步骤。",
      inputSchema: {
        query: z.string().describe("短关键词、错误信息或标识符，例如 RDK X5 烧录、零点标定、CANFD bus-off、ROS2 Jazzy 部署、IsaacLab 训练"),
        lang: z.enum(["zh", "en"]).optional().describe("语言；不传则按查询自动判断"),
        category: z.string().optional().describe("限定分类，例如 概览、部署与SDK、故障排查"),
        limit: z.number().int().min(1).max(20).optional().describe("最大命中数，默认 8"),
      },
    },
    async ({ query, lang, category, limit }) => {
      try {
        return ok(await searchDocs({ query, lang: lang as Lang | undefined, category, limit }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_page",
    {
      description:
        "读取一篇资料为 Markdown：roboparty.com 文档页面或 RP1 GitHub 仓库的 README/docs。传入 search_docs 命中的 url；可传 section（标题/锚点）只取相关小节，full=true 取整页，maxChars 控制长度。每个问题最多打开 1–2 篇。",
      inputSchema: {
        url: z.string().describe("search_docs 返回的 url（roboparty.com 文档链接或 github.com 仓库链接）"),
        section: z.string().optional().describe("要提取的小节标题或锚点"),
        full: z.boolean().optional().describe("返回整页"),
        maxChars: z.number().int().min(1000).max(40000).optional().describe("最大字符数，上限 40000"),
      },
    },
    async ({ url, section, full, maxChars }) => {
      try {
        return ok(await getPage({ url, section, full, maxChars }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_toc",
    {
      description: "列出某一分类下的文档，或已索引的 RP1 GitHub 仓库（manual 传分类名，或 rp1/github/repo）。",
      inputSchema: {
        manual: z.string().describe("分类关键字（如 概览、部署、SDK）、产品名（roboto-origin/roboto-01），或 rp1/github/repo 表示 RP1 仓库"),
        lang: z.enum(["zh", "en"]).optional().describe("语言，默认 zh"),
        query: z.string().optional().describe("可选标题过滤"),
      },
    },
    async ({ manual, lang, query }) => {
      try {
        return ok(await listToc({ manual, lang: lang as Lang | undefined, query }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
