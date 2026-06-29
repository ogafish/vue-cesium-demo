import { getSupportedPipeModelIds, normalizeModelId } from "./modelRegistry.mjs";

const SUPPORTED_PIPE_KINDS = new Set(["straight", "joint", "bend"]);
const SUPPORTED_JOINT_KINDS = new Set(["straight", "uBend", "threeWay", "fourWay", "multi"]);

export function safePathSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function assertNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是有效数字`);
  }
}

function validateJointConfig(config) {
  for (const field of ["lon", "lat", "height"]) {
    assertNumber(config.center?.[field], `center.${field}`);
  }

  if (!Array.isArray(config.branches) || config.branches.length < 2) {
    throw new Error("接头配置至少需要两条分支");
  }

  if (!SUPPORTED_JOINT_KINDS.has(config.jointKind)) {
    throw new Error(`不支持的连接头类型：${config.jointKind}`);
  }

  if (config.jointKind === "threeWay" && config.branches.length !== 3) {
    throw new Error("threeWay 三通连接头必须正好包含三条分支");
  }

  if (config.jointKind === "fourWay" && config.branches.length !== 4) {
    throw new Error("fourWay 四通连接头必须正好包含四条分支");
  }

  for (const [index, branch] of config.branches.entries()) {
    assertNumber(branch.direction?.x, `branches[${index}].direction.x`);
    assertNumber(branch.direction?.y, `branches[${index}].direction.y`);
    assertNumber(branch.direction?.z, `branches[${index}].direction.z`);

    if (
      config.jointKind === "straight" ||
      config.jointKind === "uBend" ||
      config.jointKind === "threeWay" ||
      config.jointKind === "fourWay"
    ) {
      // 这些接头必须以业务 socket 圆心和真实管径为准；缺失时不能回退到视觉推断。
      for (const field of ["lon", "lat", "height"]) {
        assertNumber(branch.socketCenter?.[field], `branches[${index}].socketCenter.${field}`);
      }
      assertNumber(branch.outerRadius, `branches[${index}].outerRadius`);
      assertNumber(branch.wallThickness, `branches[${index}].wallThickness`);
    }
  }

  assertNumber(config.branchLength, "branchLength");
  if (config.socketLength !== undefined) {
    assertNumber(config.socketLength, "socketLength");
  }
  assertNumber(config.shape?.outerRadius, "shape.outerRadius");
  assertNumber(config.shape?.wallThickness, "shape.wallThickness");

  if (config.model) {
    validateModelConfig(config.model);
  }
}

function validateModelConfig(model) {
  const modelId = normalizeModelId(model);
  if (!getSupportedPipeModelIds().has(modelId)) {
    throw new Error(`不支持的管线模型：${modelId}`);
  }
}

function validateStraightConfig(config) {
  for (const role of ["start", "end"]) {
    assertNumber(config[role]?.lon, `${role}.lon`);
    assertNumber(config[role]?.lat, `${role}.lat`);
    assertNumber(config[role]?.height, `${role}.height`);
  }

  assertNumber(config.shape?.outerRadius, "shape.outerRadius");
  assertNumber(config.shape?.wallThickness, "shape.wallThickness");

  validateModelConfig(config.model);
}

export function validatePipeTilesConfig(config) {
  if (!config?.id) {
    throw new Error("配置缺少 id");
  }

  const kind = config.kind ?? "straight";

  if (!SUPPORTED_PIPE_KINDS.has(kind)) {
    // 只允许当前明确支持的配置类型，避免未知 kind 被误当成直管生成。
    throw new Error(`不支持的管线 3D Tiles 类型：${kind}`);
  }

  if (kind === "bend") {
    // 独立弯管配置生成暂时停用；后续弯曲过渡应进入连接头模型生成流程。
    throw new Error("独立弯管 3D Tiles 生成功能已停用，请使用直管和连接头模型");
  }

  if (kind === "joint") {
    validateJointConfig(config);
    return;
  }

  validateStraightConfig(config);
}
