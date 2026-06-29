import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptPipeGlbModel } from "./glbPipeModelAdapter.mjs";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = join(CURRENT_DIR, "assets");

// 保留旧命令入口，但标准化逻辑统一走通用 GLB 适配器，避免 PVC 与后续模型各维护一套解析代码。
const result = await adaptPipeGlbModel({
  id: "pipe-pp-pvc",
  sourcePath: join(ASSET_DIR, "pipe_pp__pvc.glb"),
  outputDir: ASSET_DIR,
  styleOnly: true,
  meshPrefix: "TEAVA",
  profileFileName: "pipe_pp_pvc_style.profile.json",
  reportFileName: "pipe_pp_pvc_style.adapter-report.json",
});

console.log(`PVC pipe model adapter mode: ${result.mode}`);
console.log(`Material profile: ${result.profilePath}`);
console.log(`Adapter report: ${result.reportPath}`);
