import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { safePathSegment, validatePipeTilesConfig } from "./pipelineTiles/configValidation.mjs";
import { writePipeTileset } from "./pipelineTiles/tilesetWriter.mjs";

const configPath = resolve(
  process.cwd(),
  process.argv[2] ?? "scripts/pipelineTiles/sample-pipe-config.json",
);

const configText = (await readFile(configPath, "utf8")).replace(/^\uFEFF/, "");
const config = JSON.parse(configText);
validatePipeTilesConfig(config);

const outputSubdir = safePathSegment(config.outputSubdir ?? config.id);
const outputDir = join(process.cwd(), "public", "pipeline-tiles", "generated", outputSubdir);
const result = await writePipeTileset(config, outputDir);

console.log(`Generated pipe 3D Tiles: ${result.outputDir}`);
console.log(`Tileset URL: /pipeline-tiles/generated/${outputSubdir}/tileset.json`);
console.log(`Pipe length: ${result.length.toFixed(2)} m`);
