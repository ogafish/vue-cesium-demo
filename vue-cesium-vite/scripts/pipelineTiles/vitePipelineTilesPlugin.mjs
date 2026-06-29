import { join } from "node:path";
import { safePathSegment, validatePipeTilesConfig } from "./configValidation.mjs";
import { writePipeTileset } from "./tilesetWriter.mjs";

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function pipelineTilesPlugin() {
  return {
    name: "pipeline-tiles-generator",
    configureServer(server) {
      server.middlewares.use("/api/pipeline-tiles/generate", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { ok: false, message: "仅支持 POST" });
          return;
        }

        try {
          // 本接口只服务本地开发态：浏览器提交管线配置，Vite Node 侧写入 public/generated。
          const config = JSON.parse(await readRequestBody(request));
          validatePipeTilesConfig(config);

          const outputSubdir = safePathSegment(config.outputSubdir ?? config.id);
          const outputDir = join(
            server.config.root,
            "public",
            "pipeline-tiles",
            "generated",
            outputSubdir,
          );
          const result = await writePipeTileset(config, outputDir);

          sendJson(response, 200, {
            ok: true,
            url: `/pipeline-tiles/generated/${outputSubdir}/tileset.json`,
            length: result.length,
          });
        } catch (error) {
          sendJson(response, 400, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
  };
}
