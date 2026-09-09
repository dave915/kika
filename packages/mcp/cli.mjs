#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { deploy, pull, packageProject } from "./client.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string" },
    app: { type: "string" },
    base: { type: "string" },
    message: { type: "string" },
    destination: { type: "string" },
    revision: { type: "string" },
    output: { type: "string" },
  },
});
try {
  let result;
  if (positionals[0] === "deploy")
    result = await deploy({
      projectPath: values.project,
      appId: values.app,
      baseRevision: Number(values.base),
      message: values.message,
    });
  else if (positionals[0] === "pull")
    result = await pull({
      appId: values.app,
      revision: values.revision || "latest",
      destination: values.destination,
    });
  else if (positionals[0] === "package") {
    if (!values.output) throw Error("--output 파일 경로가 필요합니다.");
    const buffer = await packageProject({
      projectPath: values.project,
      appId: values.app,
      baseRevision: Number(values.base),
    });
    await writeFile(values.output, buffer, { flag: "wx" });
    result = { path: values.output, bytes: buffer.length };
  } else
    throw Error(
      "사용법: deploy --project PATH --app ID --base N --message TEXT | pull --app ID --destination PATH | package --project PATH --app ID --base N --output FILE.zip",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      code: error.code || "LOCAL_ADAPTER_ERROR",
      message: error.message,
    }),
  );
  process.exitCode = 1;
}
