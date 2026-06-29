import { Cartesian3 } from "cesium";
import type { PipeBusinessType, PipeJoint, PipeLine } from "../types/pipeline";
import { DEFAULT_PIPE_MODEL_ID } from "../constants/pipelineModelOptions";
import { normalizePipeBusinessTypeId, normalizePipeModelForBusiness } from "../constants/pipelineDefaults";
import {
  cartesianToLonLatHeight,
  coordinateToCartesian,
  distanceBetweenEndpoints,
  lonLatHeightToCartesian,
} from "./pipelineGeometry";
import { getPipeLineOuterRadius, getPipeLineWallThickness } from "./pipelineLineModel";

type PipeTilesBaseConfig = {
  id: string;
  outputSubdir: string;
  // 独立弯管 tiles 配置暂时停用；管线本体只生成直管，连接处弯曲由 joint 处理。
  kind: "straight" | "joint";
  shape: {
    type: "round";
    outerRadius: number;
    wallThickness: number;
    radialSegments: number;
  };
  material: {
    name: string;
    color: string;
    metallicFactor: number;
    roughnessFactor: number;
  };
};

type PipeTilesPosition = {
  lon: number;
  lat: number;
  height: number;
};

export type PipeTilesConfig = PipeTilesBaseConfig & {
  start: PipeTilesPosition;
  end: PipeTilesPosition;
  model?: {
    id: string;
  };
  // 独立弯管控制点暂时停用。
  // control?: PipeTilesPosition;
  // bend?: {
  //   radius: number;
  // };
};

export type PipeJointTilesConfig = PipeTilesBaseConfig & {
  center: PipeTilesPosition;
  jointKind: PipeJoint["jointKind"];
  model?: {
    id: string;
  };
  branchLength: number;
  socketLength: number;
  branches: Array<{
    lineId: string;
    direction: {
      x: number;
      y: number;
      z: number;
    };
    socketCenter: PipeTilesPosition;
    outerRadius: number;
    wallThickness: number;
  }>;
};

function endpointToConfigPosition(endpoint: {
  lon: number;
  lat: number;
  height: number;
}) {
  return {
    lon: endpoint.lon,
    lat: endpoint.lat,
    height: endpoint.height,
  };
}

export type PipeTilesConfigOptions = {
  outputSubdir?: string;
  joints?: PipeJoint[];
  lines?: PipeLine[];
};

export type PipeVisualEndpointRole = "start" | "end";

function getLineBusinessType(line: PipeLine, businessTypes: PipeBusinessType[]) {
  const businessTypeId = normalizePipeBusinessTypeId(line.businessTypeId);

  return businessTypes.find((businessType) => businessType.id === businessTypeId) ?? businessTypes[0] ?? null;
}

function getJointBranchLines(joint: PipeJoint, lines: PipeLine[]) {
  return joint.branchLineIds
    .map((lineId) => lines.find((line) => line.id === lineId))
    .filter((line): line is PipeLine => Boolean(line));
}

function getJointOuterRadius(joint: PipeJoint, lines: PipeLine[]) {
  const branchLines = getJointBranchLines(joint, lines);

  return Math.max(0.28, ...branchLines.map(getPipeLineOuterRadius));
}

function getUBendJointBranchLength(outerRadius: number) {
  // 平滑圆弧连接头需要给圆弧和 socket 留出实际几何空间。
  return Math.max(outerRadius * 5.8, 1.8);
}

function getEffectiveJointBranchLength(joint: PipeJoint, outerRadius: number) {
  if (joint.jointKind === "uBend") {
    return getUBendJointBranchLength(outerRadius);
  }

  if (joint.jointKind === "threeWay") {
    // 三通 socket 使用平滑圆弧连接头回退距离的 60%，保持中心融合区紧凑。
    return getUBendJointBranchLength(outerRadius) * 0.6;
  }

  if (joint.jointKind === "fourWay") {
    return Math.max(outerRadius * 1.8, 0.75);
  }

  if (joint.degree <= 2) {
    return Math.max(outerRadius * 3.2, 1.0);
  }

  return Math.max(outerRadius * 4.2, 1.4);
}

function getJointSocketLength(joint: PipeJoint, lines: PipeLine[]) {
  // socketLength 是直管视觉端点和接头端部圆心共同使用的业务切点距离。
  const outerRadius = getJointOuterRadius(joint, lines);

  return getEffectiveJointBranchLength(joint, getJointOuterRadius(joint, lines));
}

function findLineJointBranch(
  line: PipeLine,
  role: "start" | "end",
  joints: PipeJoint[],
) {
  for (const joint of joints) {
    const branch = joint.branches.find(
      (candidate) => candidate.lineId === line.id && candidate.endpointRole === role,
    );

    if (branch) {
      return { joint, branch };
    }
  }

  return null;
}

function makeSocketCutPosition(joint: PipeJoint, direction: { x: number; y: number; z: number }, length: number) {
  const center = coordinateToCartesian(joint.position);
  const rawDirection = new Cartesian3(direction.x, direction.y, direction.z);

  if (Cartesian3.magnitude(rawDirection) < 1e-6 || length <= 0) {
    return cartesianToLonLatHeight(center);
  }

  const directionCartesian = Cartesian3.normalize(rawDirection, new Cartesian3());
  const cutPoint = Cartesian3.add(
    center,
    Cartesian3.multiplyByScalar(directionCartesian, length, new Cartesian3()),
    new Cartesian3(),
  );

  return cartesianToLonLatHeight(cutPoint);
}

function makeSocketAdjustedEndpoint(
  line: PipeLine,
  role: "start" | "end",
  joints: PipeJoint[],
  lines: PipeLine[],
  scale: number,
) {
  const endpoint = role === "start" ? line.start : line.end;
  const match = findLineJointBranch(line, role, joints);

  if (!match) {
    return endpointToConfigPosition(endpoint);
  }

  // 业务端点不变；这里只回退 3D Tiles 直管的视觉端点，让接头占据连接空间。
  return makeSocketCutPosition(
    match.joint,
    match.branch.direction,
    getJointSocketLength(match.joint, lines) * scale,
  );
}

function getEndpointSocketLength(line: PipeLine, role: "start" | "end", joints: PipeJoint[], lines: PipeLine[]) {
  const match = findLineJointBranch(line, role, joints);

  return match ? getJointSocketLength(match.joint, lines) : 0;
}

function getSocketScale(line: PipeLine, joints: PipeJoint[], lines: PipeLine[]) {
  const startSocketLength = getEndpointSocketLength(line, "start", joints, lines);
  const endSocketLength = getEndpointSocketLength(line, "end", joints, lines);
  const totalSocketLength = startSocketLength + endSocketLength;

  if (totalSocketLength <= 0) {
    return 1;
  }

  const lineLength = distanceBetweenEndpoints(line.start, line.end);
  const minVisualLength = Math.max(getPipeLineOuterRadius(line) * 1.2, 0.3);
  const maxSocketLength = Math.max(0, lineLength - minVisualLength);

  // 管线很短时按比例缩短两端 socket，防止视觉直管起终点反转。
  return totalSocketLength > maxSocketLength ? maxSocketLength / totalSocketLength : 1;
}

export function buildPipeTilesConfig(
  line: PipeLine,
  businessTypes: PipeBusinessType[],
  options: PipeTilesConfigOptions = {},
): PipeTilesConfig {
  const businessType = getLineBusinessType(line, businessTypes);
  const joints = options.joints ?? [];
  const lines = options.lines ?? [line];
  const socketScale = getSocketScale(line, joints, lines);

  return {
    id: line.id,
    kind: "straight",
    // outputSubdir 可单独指定，用于重新生成时避开浏览器和 Cesium 对旧 b3dm 的缓存。
    outputSubdir: options.outputSubdir ?? line.id,
    start: makeSocketAdjustedEndpoint(line, "start", joints, lines, socketScale),
    end: makeSocketAdjustedEndpoint(line, "end", joints, lines, socketScale),
    // 模型选择只影响视觉 3D Tiles；业务连接仍以 socket/cutback 几何为准，不能由 GLB 反向决定。
    model: {
      id: normalizePipeModelForBusiness(line.businessTypeId, line.modelId ?? DEFAULT_PIPE_MODEL_ID),
    },
    shape: {
      type: "round",
      // 第一版精细 3D Tiles 只生成直圆管；矩形管先按等效外半径降级，后续再扩展方管 mesh。
      outerRadius: getPipeLineOuterRadius(line),
      wallThickness: line.shape.thickness,
      radialSegments: 96,
    },
    material: {
      name: businessType?.name ?? "给水",
      color: businessType?.color ?? "#2f80ed",
      metallicFactor: 0.06,
      roughnessFactor: 0.46,
    },
  };
}

export function getPipeVisualEndpoint(
  line: PipeLine,
  role: PipeVisualEndpointRole,
  businessTypes: PipeBusinessType[],
  options: PipeTilesConfigOptions = {},
) {
  // Entity rendering and 3D Tiles generation must share the same socket/cutback endpoint.
  // Keep this as the single read path so visual fallback models cannot drift away from refined tiles.
  const config = buildPipeTilesConfig(line, businessTypes, options);

  return role === "start" ? config.start : config.end;
}

export function getPipeVisualEndpointCartesian(
  line: PipeLine,
  role: PipeVisualEndpointRole,
  businessTypes: PipeBusinessType[],
  options: PipeTilesConfigOptions = {},
) {
  const endpoint = getPipeVisualEndpoint(line, role, businessTypes, options);

  return lonLatHeightToCartesian(endpoint.lon, endpoint.lat, endpoint.height);
}

export function buildPipeJointTilesConfig(
  joint: PipeJoint,
  lines: PipeLine[],
  businessTypes: PipeBusinessType[],
  options: PipeTilesConfigOptions = {},
): PipeJointTilesConfig {
  const branchLines = getJointBranchLines(joint, lines);
  const allJoints = options.joints ?? [joint];
  const businessTypeId = normalizePipeBusinessTypeId(joint.businessTypeId ?? branchLines[0]?.businessTypeId);
  const modelId = normalizePipeModelForBusiness(businessTypeId, joint.modelId ?? DEFAULT_PIPE_MODEL_ID);
  const businessType =
    businessTypes.find((candidate) => candidate.id === businessTypeId) ??
    businessTypes[0] ??
    null;
  const outerRadius = getJointOuterRadius(joint, lines);
  const wallThickness = Math.min(
    outerRadius * 0.45,
    Math.max(0.02, ...branchLines.map(getPipeLineWallThickness)),
  );
  const branchLength = getEffectiveJointBranchLength(joint, outerRadius);

  return {
    id: joint.id,
    kind: "joint",
    jointKind: joint.jointKind,
    model: { id: modelId },
    // 接头拓扑变化时用新目录避开浏览器和 Cesium 对旧 b3dm 的缓存。
    outputSubdir: options.outputSubdir ?? joint.id,
    center: {
      lon: joint.position.lon,
      lat: joint.position.lat,
      height: joint.position.height,
    },
    branchLength,
    socketLength: getJointSocketLength(joint, lines),
    branches: joint.branches.map((branch) => {
      const line = lines.find((candidate) => candidate.id === branch.lineId);
      const socketScale = line ? getSocketScale(line, allJoints, lines) : 1;

      return {
        lineId: branch.lineId,
        direction: branch.direction,
        // socketCenter 是直管回退后的端部圆心；一字套筒必须用它做真实几何端点。
        socketCenter: makeSocketCutPosition(
          joint,
          branch.direction,
          getJointSocketLength(joint, lines) * socketScale,
        ),
        outerRadius: branch.outerRadius,
        wallThickness: branch.wallThickness,
      };
    }),
    shape: {
      type: "round",
      outerRadius,
      wallThickness,
      radialSegments: 72,
    },
    material: {
      name: `${joint.jointLabel}接头`,
      color: businessType?.color ?? "#22c55e",
      metallicFactor: 0.08,
      roughnessFactor: 0.42,
    },
  };
}

export function buildGeneratedPipeTilesetUrl(lineId: string) {
  return `/pipeline-tiles/generated/${encodeURIComponent(lineId)}/tileset.json`;
}
