import {
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Cartographic,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from "cesium";
import type { PipeEndpoint, PipeLine, PipePoint, PipeShape } from "../types/pipeline";
import type { PipeCoordinate } from "../types/pipeline";

export function createPointId(index: number) {
  return `P${String(index).padStart(4, "0")}`;
}

export function createLineId(index: number) {
  return `L${String(index).padStart(4, "0")}`;
}

export function cartesianToLonLatHeight(cartesian: Cartesian3) {
  const cartographic = Cartographic.fromCartesian(cartesian);

  return {
    lon: CesiumMath.toDegrees(cartographic.longitude),
    lat: CesiumMath.toDegrees(cartographic.latitude),
    height: cartographic.height,
  };
}

export function lonLatHeightToCartesian(lon: number, lat: number, height: number) {
  return Cartesian3.fromDegrees(lon, lat, height);
}

export function coordinateToCartesian(coordinate: PipeCoordinate) {
  return lonLatHeightToCartesian(coordinate.lon, coordinate.lat, coordinate.height);
}

export function endpointToCartesian(endpoint: PipeEndpoint) {
  return lonLatHeightToCartesian(endpoint.lon, endpoint.lat, endpoint.height);
}

export function pointToCartesian(point: PipePoint) {
  return lonLatHeightToCartesian(point.lon, point.lat, point.height);
}

export function distanceBetweenEndpoints(start: PipeEndpoint, end: PipeEndpoint) {
  return Cartesian3.distance(endpointToCartesian(start), endpointToCartesian(end));
}

export function buildPointEndpointKey(pointId: string) {
  return `point:${pointId}`;
}

export function buildLineEndpointKey(lineId: string, role: "start" | "end") {
  return `line:${lineId}:${role}`;
}

export function buildFreeEndpointKey(lon: number, lat: number, height: number) {
  return `free:${lon.toFixed(7)}:${lat.toFixed(7)}:${height.toFixed(2)}`;
}

// 将“管线端点 handle”递归还原到真实源端点，避免同一物理端点有多个 endpointKey。
export function resolveEndpointKey(endpoint: PipeEndpoint, lines: PipeLine[], visited = new Set<string>()) {
  if (endpoint.sourceType === "point" && endpoint.pointId) {
    return buildPointEndpointKey(endpoint.pointId);
  }

  // visited 用于防止异常环形引用导致递归死循环。
  if (!endpoint.lineId || !endpoint.endpointRole || visited.has(endpoint.endpointKey)) {
    return endpoint.endpointKey;
  }

  visited.add(endpoint.endpointKey);

  const sourceLine = lines.find((line) => line.id === endpoint.lineId);
  if (!sourceLine) {
    return endpoint.endpointKey;
  }

  const sourceEndpoint = endpoint.endpointRole === "start" ? sourceLine.start : sourceLine.end;
  return resolveEndpointKey(sourceEndpoint, lines, visited);
}

// 连接 key 使用真实端点归一化结果，保证 A-B 和 B-A 被识别为同一条管线。
export function buildConnectionKey(start: PipeEndpoint, end: PipeEndpoint, lines: PipeLine[] = []) {
  return [resolveEndpointKey(start, lines), resolveEndpointKey(end, lines)].sort().join("|");
}

export function createEndpointFromPoint(point: PipePoint): PipeEndpoint {
  return {
    endpointKey: buildPointEndpointKey(point.id),
    sourceType: "point",
    sourceId: point.id,
    lon: point.lon,
    lat: point.lat,
    height: point.height,
    pointId: point.id,
  };
}

export function createEndpointFromLine(line: PipeLine, role: "start" | "end"): PipeEndpoint {
  const endpoint = role === "start" ? line.start : line.end;

  return {
    endpointKey: buildLineEndpointKey(line.id, role),
    sourceType: "line-endpoint",
    sourceId: line.id,
    lon: endpoint.lon,
    lat: endpoint.lat,
    height: endpoint.height,
    lineId: line.id,
    endpointRole: role,
  };
}

export function createFreeEndpoint(coordinate: PipeCoordinate): PipeEndpoint {
  const endpointKey = buildFreeEndpointKey(coordinate.lon, coordinate.lat, coordinate.height);

  return {
    endpointKey,
    sourceType: "free",
    sourceId: endpointKey,
    lon: coordinate.lon,
    lat: coordinate.lat,
    height: coordinate.height,
  };
}

// 为 Cesium polylineVolume 生成管道截面；当前支持圆管和矩形管。
export function makePipeVolumeShape(shape: PipeShape) {
  if (shape.type === "rectangle") {
    const halfWidth = shape.width / 2;
    const halfHeight = shape.height / 2;

    return [
      new Cartesian2(-halfWidth, -halfHeight),
      new Cartesian2(halfWidth, -halfHeight),
      new Cartesian2(halfWidth, halfHeight),
      new Cartesian2(-halfWidth, halfHeight),
    ];
  }

  const points: Cartesian2[] = [];
  const segments = 24;

  for (let i = 0; i < segments; i += 1) {
    const angle = (CesiumMath.TWO_PI * i) / segments;
    points.push(new Cartesian2(Math.cos(angle) * shape.radius, Math.sin(angle) * shape.radius));
  }

  return points;
}

// 以管点位置建立局部 ENU 坐标轴，X=East、Y=North、Z=Up。
export function getEnuAxisDirection(center: Cartesian3, axis: "x" | "y" | "z") {
  const transform = Transforms.eastNorthUpToFixedFrame(center);
  const columnIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const column = Matrix4.getColumn(transform, columnIndex, new Cartesian4());
  const direction = new Cartesian3(column.x, column.y, column.z);

  return Cartesian3.normalize(direction, direction);
}

export function makeAxisPositions(center: Cartesian3, axis: "x" | "y" | "z", length: number) {
  const direction = getEnuAxisDirection(center, axis);
  const end = Cartesian3.add(
    center,
    Cartesian3.multiplyByScalar(direction, length, new Cartesian3()),
    new Cartesian3(),
  );

  return [center, end];
}

export function formatMeters(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${value.toFixed(digits)} m`;
}

export function formatCoordinate(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return value.toFixed(7);
}

export function formatEndpointLabel(endpoint: PipeEndpoint | null | undefined) {
  if (!endpoint) {
    return "未选择";
  }

  if (endpoint.sourceType === "free") {
    return `临时弯折点 ${formatCoordinate(endpoint.lon)}, ${formatCoordinate(endpoint.lat)}`;
  }

  return endpoint.endpointKey;
}
