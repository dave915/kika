#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deploy, pull } from "./client.mjs";
const server = new McpServer({ name: "kika-sandbox-local", version: "0.1.0" });
const appId = z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/);
const wrap = (fn) => async (args) => {
  try {
    const result = await fn(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: error.code || "LOCAL_ADAPTER_ERROR",
            message: error.message,
          }),
        },
      ],
    };
  }
};
server.registerTool(
  "deploy",
  {
    description:
      "로컬 정적 앱을 빌드·검증·업로드하여 미리보기 리비전을 생성합니다. 게시와 별개입니다. loopback 체험 서버 전용.",
    inputSchema: {
      projectPath: z.string(),
      appId,
      baseRevision: z.number().int().nonnegative(),
      message: z.string().min(1).max(500),
    },
  },
  wrap(deploy),
);
server.registerTool(
  "pull",
  {
    description:
      "검증된 소스를 새 디렉토리에 복원하고 SHA-256을 확인합니다. 기존 디렉토리를 덮어쓰지 않습니다.",
    inputSchema: {
      appId,
      revision: z
        .union([z.literal("latest"), z.number().int().positive()])
        .default("latest"),
      destination: z.string(),
    },
  },
  wrap(pull),
);
await server.connect(new StdioServerTransport());
