import type { PipeLine } from "../types/pipeline";

export function getPipeLineOuterRadius(line: PipeLine) {
  // 所有管线建模入口统一从这里读取外半径；方管第一版按外接圆半径参与精细模型生成。
  return line.shape.type === "circle"
    ? line.shape.radius
    : Math.max(line.shape.width, line.shape.height) / 2;
}

export function getPipeLineWallThickness(line: PipeLine) {
  // 壁厚属于业务断面参数，接头签名、socket 计算和 3D Tiles 生成必须使用同一口径。
  return line.shape.thickness;
}
