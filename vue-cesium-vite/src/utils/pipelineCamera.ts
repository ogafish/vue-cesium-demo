import {
  BoundingSphere,
  Cartesian3,
  HeadingPitchRange,
  Math as CesiumMath,
  Viewer,
} from "cesium";
import type { PipeEndpoint, PipeLine, PipePoint } from "../types/pipeline";
import { endpointToCartesian, pointToCartesian } from "./pipelineGeometry";

const PIPELINE_FLY_HEADING = CesiumMath.toRadians(45);
const PIPELINE_FLY_PITCH = CesiumMath.toRadians(-35);
const POINT_TARGET_RADIUS_METERS = 60;
const MIN_TARGET_RANGE_METERS = 180;
const UNDERGROUND_RANGE_PADDING_METERS = 120;
const LINE_RANGE_MULTIPLIER = 2.8;

type PipelineCameraContext = {
  points: PipePoint[];
  lines: PipeLine[];
};

function getPointDepth(point: PipePoint) {
  // relativeHeight 已经是“距地高度”，地下为负数；优先用它计算需要抬高的观察距离。
  if (Number.isFinite(point.relativeHeight) && point.relativeHeight < 0) {
    return Math.abs(point.relativeHeight);
  }

  if (point.groundHeight !== null && point.height < point.groundHeight) {
    return point.groundHeight - point.height;
  }

  return 0;
}

function findPointForEndpoint(
  endpoint: PipeEndpoint,
  context: PipelineCameraContext,
  visited = new Set<string>(),
): PipePoint | null {
  if (endpoint.pointId) {
    return context.points.find((point) => point.id === endpoint.pointId) ?? null;
  }

  if (!endpoint.lineId || !endpoint.endpointRole || visited.has(endpoint.endpointKey)) {
    return null;
  }

  visited.add(endpoint.endpointKey);

  const sourceLine = context.lines.find((line) => line.id === endpoint.lineId);
  if (!sourceLine) {
    return null;
  }

  // 管线端点可能来自另一条管线的端点，递归追溯到真实管点后才能拿到可靠埋深。
  const sourceEndpoint =
    endpoint.endpointRole === "start" ? sourceLine.start : sourceLine.end;
  return findPointForEndpoint(sourceEndpoint, context, visited);
}

function getEndpointDepth(endpoint: PipeEndpoint, context: PipelineCameraContext) {
  const point = findPointForEndpoint(endpoint, context);
  return point ? getPointDepth(point) : 0;
}

function getRangeForTarget(radius: number, undergroundDepth: number) {
  const baseRange = Math.max(MIN_TARGET_RANGE_METERS, radius * LINE_RANGE_MULTIPLIER);
  const pitchLift = Math.sin(Math.abs(PIPELINE_FLY_PITCH));
  const undergroundRange =
    undergroundDepth > 0
      ? undergroundDepth / pitchLift + UNDERGROUND_RANGE_PADDING_METERS
      : 0;

  // 地下对象不能用固定 160m 这类短距离，否则最终相机可能仍在地表以下并被 Cesium 碰撞检测推出。
  return Math.max(baseRange, undergroundRange);
}

function flyToSphere(viewer: Viewer, sphere: BoundingSphere, undergroundDepth: number) {
  const controller = viewer.scene.screenSpaceCameraController;
  const previousCollisionDetection = controller.enableCollisionDetection;
  const range = getRangeForTarget(sphere.radius, undergroundDepth);

  function restoreCollisionDetection() {
    controller.enableCollisionDetection = previousCollisionDetection;
  }

  viewer.camera.cancelFlight();
  viewer.trackedEntity = undefined;

  // 飞行过程中临时关闭碰撞检测，避免穿过地表附近时被地形约束反复推离目标点。
  controller.enableCollisionDetection = false;
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 0.7,
    offset: new HeadingPitchRange(PIPELINE_FLY_HEADING, PIPELINE_FLY_PITCH, range),
    complete: restoreCollisionDetection,
    cancel: restoreCollisionDetection,
  });
}

export function flyToPipelinePoint(viewer: Viewer, point: PipePoint) {
  const sphere = new BoundingSphere(pointToCartesian(point), POINT_TARGET_RADIUS_METERS);
  flyToSphere(viewer, sphere, getPointDepth(point));
}

export function flyToPipelineLine(
  viewer: Viewer,
  line: PipeLine,
  context: PipelineCameraContext,
) {
  const sphere = BoundingSphere.fromPoints([
    endpointToCartesian(line.start),
    endpointToCartesian(line.end),
  ]);
  const undergroundDepth = Math.max(
    getEndpointDepth(line.start, context),
    getEndpointDepth(line.end, context),
  );

  flyToSphere(viewer, sphere, undergroundDepth);
}
