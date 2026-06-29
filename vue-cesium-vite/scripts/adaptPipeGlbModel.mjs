import { resolve } from "node:path";
import { adaptPipeGlbModel, getDefaultOutputDir } from "./pipelineTiles/glbPipeModelAdapter.mjs";

function readArgs(argv) {
  const args = {
    styleOnly: false,
    allowTemplate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];

    if (key === "--style-only") {
      args.styleOnly = true;
    } else if (key === "--allow-template") {
      args.allowTemplate = true;
    } else if (key === "--source") {
      args.sourcePath = next;
      index += 1;
    } else if (key === "--id") {
      args.id = next;
      index += 1;
    } else if (key === "--output-dir") {
      args.outputDir = next;
      index += 1;
    } else if (key === "--mesh-prefix") {
      args.meshPrefix = next;
      index += 1;
    } else if (key === "--template-name") {
      args.templateFileName = next;
      index += 1;
    } else if (key === "--profile-name") {
      args.profileFileName = next;
      index += 1;
    } else if (key === "--meta-name") {
      args.metaFileName = next;
      index += 1;
    } else if (key === "--report-name") {
      args.reportFileName = next;
      index += 1;
    } else {
      throw new Error(`未知参数：${key}`);
    }
  }

  if (!args.sourcePath) {
    throw new Error("缺少 --source <glb路径>");
  }
  if (!args.id) {
    throw new Error("缺少 --id <模型ID>");
  }

  args.sourcePath = resolve(process.cwd(), args.sourcePath);
  args.outputDir = args.outputDir
    ? resolve(process.cwd(), args.outputDir)
    : getDefaultOutputDir(args.sourcePath);

  return args;
}

const options = readArgs(process.argv.slice(2));
const result = await adaptPipeGlbModel(options);

console.log(`GLB model adapter mode: ${result.mode}`);
console.log(`Profile: ${result.profilePath}`);
console.log(`Report: ${result.reportPath}`);

if (result.templatePath) {
  console.log(`Template: ${result.templatePath}`);
  console.log(`Template metadata: ${result.metaPath}`);
} else {
  console.log("Template: skipped, this GLB should use procedural geometry with extracted material style.");
}
