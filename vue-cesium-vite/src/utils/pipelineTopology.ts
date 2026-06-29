import { Cartesian3, Math as CesiumMath } from "cesium";
import type {
  PipeConnectionBranch,
  PipeConnectionDirection,
  PipeConnectionNode,
  PipeEndpoint,
  PipeJoint,
  PipeJointKind,
  PipeLine,
} from "../types/pipeline";
import {
  getEditableJointKindsByDegree,
  getPipeJointKindLabel,
  normalizePipeJointKind,
} from "../constants/pipelineJointOptions";
import {
  getDefaultPipeModelIdForBusiness,
  normalizePipeBusinessTypeId,
  normalizePipeModelForBusiness,
} from "../constants/pipelineDefaults";
import {
  cartesianToLonLatHeight,
  endpointToCartesian,
  resolveEndpointKey,
} from "./pipelineGeometry";
import { getPipeLineOuterRadius } from "./pipelineLineModel";

const STRAIGHT_ANGLE_THRESHOLD_DEGREES = 175;
const JOINT_GEOMETRY_VERSION = "joint-arc-demo-v5";
const FOUR_WAY_GEOMETRY_VERSION = "four-way-hub-spokes-v1";
const SOCKET_GEOMETRY_VERSION = "socket-cutback-v2";

function directionToPlain(direction: Cartesian3): PipeConnectionDirection {
  return {
    x: direction.x,
    y: direction.y,
    z: direction.z,
  };
}

function plainToDirection(direction: PipeConnectionDirection) {
  return new Cartesian3(direction.x, direction.y, direction.z);
}

function angleBetweenDirections(first: PipeConnectionDirection, second: PipeConnectionDirection) {
  const firstCartesian = plainToDirection(first);
  const secondCartesian = plainToDirection(second);
  const dot = Cartesian3.dot(firstCartesian, secondCartesian);

  return CesiumMath.toDegrees(Math.acos(Math.min(Math.max(dot, -1), 1)));
}

function makeNodeId(nodeKey: string) {
  return `N-${nodeKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function makeJointId(nodeId: string) {
  return `J-${nodeId}`;
}

function getPointIdFromNodeKey(nodeKey: string) {
  // 管点是管线连接业务的真实节点；拓扑 nodeKey 以 point:<id> 开头时可直接还原管点 ID。
  const rawNodeKey = nodeKey.split("|business:")[0];

  return rawNodeKey.startsWith("point:") ? rawNodeKey.slice("point:".length) : undefined;
}

function makeBusinessNodeKey(nodeKey: string, businessTypeId: string) {
  return `${nodeKey}|business:${businessTypeId}`;
}

function makeJointLabel(jointKind: PipeJointKind) {
  return getPipeJointKindLabel(jointKind);
}

function rounded(value: number, precision = 6) {
  return Number(value.toFixed(precision));
}

export function makeJointGeometrySignature(
  node: PipeConnectionNode,
  material?: { businessTypeId?: string; modelId?: string },
) {
  // 连接接头的生成结果由节点类型、空间位置和每个分支方向共同决定；签名变化就需要重建 3D Tiles。
  const geometryVersion =
    node.jointKind === "fourWay"
    ? `${JOINT_GEOMETRY_VERSION}:${FOUR_WAY_GEOMETRY_VERSION}`
    : JOINT_GEOMETRY_VERSION;
  const branchPart = node.branches
    .map((branch) => [
      branch.lineId,
      branch.endpointRole,
      rounded(branch.outerRadius, 3),
      rounded(branch.wallThickness, 3),
      branch.businessTypeId ?? "",
      rounded(branch.direction.x),
      rounded(branch.direction.y),
      rounded(branch.direction.z),
    ].join(":"))
    .sort()
    .join("|");

  return [
    geometryVersion,
    node.jointKind,
    material?.businessTypeId ?? "",
    material?.modelId ?? "",
    rounded(node.position.lon, 8),
    rounded(node.position.lat, 8),
    rounded(node.position.height, 3),
    branchPart,
  ].join("#");
}

function makeJointSocketSignature(node: PipeConnectionNode) {
  const branchPart = node.branches
    .map((branch) => [
      branch.lineId,
      branch.endpointRole,
      rounded(branch.outerRadius, 3),
      rounded(branch.wallThickness, 3),
      rounded(branch.direction.x),
      rounded(branch.direction.y),
      rounded(branch.direction.z),
    ].join(":"))
    .sort()
    .join("|");

  return [
    SOCKET_GEOMETRY_VERSION,
    node.jointKind,
    node.degree,
    rounded(node.position.lon, 8),
    rounded(node.position.lat, 8),
    rounded(node.position.height, 3),
    branchPart,
  ].join("#");
}

function getLineEndpoint(line: PipeLine, role: "start" | "end"): PipeEndpoint {
  return role === "start" ? line.start : line.end;
}

function getBranchTargetCartesian(line: PipeLine, role: "start" | "end") {
  return endpointToCartesian(role === "start" ? line.end : line.start);
}

function getBranchDirection(line: PipeLine, role: "start" | "end") {
  const endpointCartesian = endpointToCartesian(getLineEndpoint(line, role));
  const targetCartesian = getBranchTargetCartesian(line, role);
  const direction = Cartesian3.subtract(targetCartesian, endpointCartesian, new Cartesian3());

  return directionToPlain(Cartesian3.normalize(direction, direction));
}

function classifyJoint(branches: PipeConnectionBranch[]): PipeJointKind {
  if (branches.length <= 1) {
    return "terminal";
  }

  if (branches.length === 2) {
    const angleDeg = angleBetweenDirections(branches[0].direction, branches[1].direction);
    // 两管连接时，一字只适配近似直线对接；非直线默认给平滑圆弧连接头，不再保留旧占位接头。
    return angleDeg >= STRAIGHT_ANGLE_THRESHOLD_DEGREES ? "straight" : "uBend";
  }

  if (branches.length === 3) {
    // 三管连接统一归为 threeWay，不再按角度拆分 T 型和 Y 型。
    return "threeWay";
  }

  if (branches.length === 4) {
    return "fourWay";
  }

  return "multi";
}

export function buildPipeConnectionNodes(lines: PipeLine[]): PipeConnectionNode[] {
  const nodesByKey = new Map<
    string,
    {
      nodeKey: string;
      positions: Cartesian3[];
      branches: PipeConnectionBranch[];
    }
  >();

  for (const line of lines) {
    for (const role of ["start", "end"] as const) {
      const endpoint = getLineEndpoint(line, role);
      const businessTypeId = normalizePipeBusinessTypeId(line.businessTypeId);
      const nodeKey = makeBusinessNodeKey(resolveEndpointKey(endpoint, lines), businessTypeId);
      const node = nodesByKey.get(nodeKey) ?? {
        nodeKey,
        positions: [],
        branches: [],
      };

      // 节点位置从所有归一化端点求平均，能容忍后续吸附阈值带来的微小坐标误差。
      node.positions.push(endpointToCartesian(endpoint));
      node.branches.push({
        lineId: line.id,
        endpointRole: role,
        endpointKey: endpoint.endpointKey,
        lineKind: line.kind,
        outerRadius: getPipeLineOuterRadius(line),
        wallThickness: line.shape.thickness,
        businessTypeId,
        direction: getBranchDirection(line, role),
      });
      nodesByKey.set(nodeKey, node);
    }
  }

  return Array.from(nodesByKey.values()).map((node) => {
    const center = Cartesian3.divideByScalar(
      node.positions.reduce(
        (sum, position) => Cartesian3.add(sum, position, sum),
        new Cartesian3(),
      ),
      node.positions.length,
      new Cartesian3(),
    );
    const recommendedJointKind = classifyJoint(node.branches);

    return {
      id: makeNodeId(node.nodeKey),
      nodeKey: node.nodeKey,
      pointId: getPointIdFromNodeKey(node.nodeKey),
      position: cartesianToLonLatHeight(center),
      degree: node.branches.length,
      connectionLineIds: Array.from(new Set(node.branches.map((branch) => branch.lineId))),
      jointKind: recommendedJointKind,
      recommendedJointKind,
      jointLabel: makeJointLabel(recommendedJointKind),
      branches: node.branches,
    };
  });
}

export function buildPipeJoints(
  nodes: PipeConnectionNode[],
  previousJoints: PipeJoint[] = [],
): PipeJoint[] {
  const previousById = new Map(previousJoints.map((joint) => [joint.id, joint]));
  const now = new Date().toISOString();

  return nodes
    .filter((node) => node.jointKind !== "terminal")
    .map((node) => {
      const id = makeJointId(node.id);
      const previous = previousById.get(id);
      const allowedKinds = getEditableJointKindsByDegree(node.degree);
      const previousJointKind = normalizePipeJointKind(previous?.jointKind as string | undefined);
      const canKeepManualKind =
        Boolean(previous?.manualOverride) && allowedKinds.includes(previousJointKind);
      const jointKind = canKeepManualKind ? previousJointKind : node.recommendedJointKind;
      const defaultBusinessTypeId = normalizePipeBusinessTypeId(node.branches[0]?.businessTypeId);
      const businessTypeId = normalizePipeBusinessTypeId(previous?.businessTypeId ?? defaultBusinessTypeId);
      const modelId = normalizePipeModelForBusiness(
        businessTypeId,
        previous?.modelId ?? getDefaultPipeModelIdForBusiness(businessTypeId),
      );
      const effectiveNode = {
        ...node,
        jointKind,
        jointLabel: makeJointLabel(jointKind),
      };
      const geometrySignature = makeJointGeometrySignature(effectiveNode, { businessTypeId, modelId });
      const socketSignature = makeJointSocketSignature(effectiveNode);
      const shouldKeepLoadedModel =
        previous?.geometrySignature === geometrySignature &&
        previous.socketSignature === socketSignature &&
        (previous.detailModelStatus === "loaded" || previous.detailModelStatus === "generating") &&
        Boolean(previous.detailTilesetUrl);

      // 接头对象是后续精细管件的业务载体；拓扑没变时保留已加载模型，拓扑变了就标记为 dirty 等待重建。
      return {
        id,
        nodeId: node.id,
        nodeKey: node.nodeKey,
        pointId: node.pointId,
        jointKind,
        recommendedJointKind: node.recommendedJointKind,
        jointLabel: makeJointLabel(jointKind),
        manualOverride: canKeepManualKind ? previous!.manualOverride : false,
        position: node.position,
        degree: node.degree,
        connectionLineIds: node.connectionLineIds,
        branches: node.branches,
        branchLineIds: Array.from(new Set(node.branches.map((branch) => branch.lineId))),
        businessTypeId,
        modelId,
        geometrySignature,
        socketSignature,
        detailModelStatus: shouldKeepLoadedModel
          ? previous.detailModelStatus
          : previous?.detailTilesetUrl
            ? "dirty"
            : "none",
        detailTilesetUrl: previous?.detailTilesetUrl,
        createdAt: previous?.createdAt ?? now,
        updatedAt: previous?.geometrySignature === geometrySignature ? previous.updatedAt : now,
      } satisfies PipeJoint;
    });
}
