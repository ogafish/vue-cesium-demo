const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

export function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function multiplyByScalar(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function magnitude(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize(vector, fallback = [1, 0, 0]) {
  const length = magnitude(vector);
  return length > 0 ? multiplyByScalar(vector, 1 / length) : fallback;
}

export function ecefFromDegrees(lonDeg, latDeg, height) {
  const lon = degreesToRadians(lonDeg);
  const lat = degreesToRadians(latDeg);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);

  return [
    (n + height) * cosLat * Math.cos(lon),
    (n + height) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + height) * sinLat,
  ];
}

function geodeticUpFromDegrees(lonDeg, latDeg) {
  const lon = degreesToRadians(lonDeg);
  const lat = degreesToRadians(latDeg);

  return [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
}

function eastFromDegrees(lonDeg) {
  const lon = degreesToRadians(lonDeg);
  return [-Math.sin(lon), Math.cos(lon), 0];
}

export function buildPipePlacement(start, end) {
  const startEcef = ecefFromDegrees(start.lon, start.lat, start.height);
  const endEcef = ecefFromDegrees(end.lon, end.lat, end.height);
  const center = multiplyByScalar(add(startEcef, endEcef), 0.5);
  const pipeVector = subtract(endEcef, startEcef);
  const length = magnitude(pipeVector);

  if (length <= 0) {
    throw new Error("管线起点和终点不能重合");
  }

  const xAxis = normalize(pipeVector);
  const midLon = (start.lon + end.lon) / 2;
  const midLat = (start.lat + end.lat) / 2;
  const up = geodeticUpFromDegrees(midLon, midLat);
  let zAxis = subtract(up, multiplyByScalar(xAxis, dot(up, xAxis)));

  if (magnitude(zAxis) < 1e-6) {
    // 近似垂直管线时，用东向量作为备用参考，避免局部坐标轴退化。
    const east = eastFromDegrees(midLon);
    zAxis = subtract(east, multiplyByScalar(xAxis, dot(east, xAxis)));
  }

  zAxis = normalize(zAxis, [0, 0, 1]);
  const yAxis = normalize(cross(zAxis, xAxis), [0, 1, 0]);

  return {
    length,
    transform: [
      xAxis[0], xAxis[1], xAxis[2], 0,
      yAxis[0], yAxis[1], yAxis[2], 0,
      zAxis[0], zAxis[1], zAxis[2], 0,
      center[0], center[1], center[2], 1,
    ],
  };
}

function toLocal(point, origin, axes) {
  const relative = subtract(point, origin);

  return [
    dot(relative, axes.x),
    dot(relative, axes.y),
    dot(relative, axes.z),
  ];
}

// 独立三点弯管 placement 已停用；后续如需恢复，应基于连接头/socket 业务重新设计接口。
// export function buildBendPipePlacement(start, control, end) {
//   const startEcef = ecefFromDegrees(start.lon, start.lat, start.height);
//   const controlEcef = ecefFromDegrees(control.lon, control.lat, control.height);
//   const endEcef = ecefFromDegrees(end.lon, end.lat, end.height);
//   ...
// }

export function buildJointPlacement(center) {
  const centerEcef = ecefFromDegrees(center.lon, center.lat, center.height);
  const up = geodeticUpFromDegrees(center.lon, center.lat);
  const east = eastFromDegrees(center.lon);
  const north = normalize(cross(up, east), [0, 1, 0]);

  // 接头模型以节点为局部原点，ENU 轴作为稳定局部坐标系，便于把拓扑分支方向投影为局部短管。
  return {
    transform: [
      east[0], east[1], east[2], 0,
      north[0], north[1], north[2], 0,
      up[0], up[1], up[2], 0,
      centerEcef[0], centerEcef[1], centerEcef[2], 1,
    ],
    origin: centerEcef,
    axes: {
      x: east,
      y: north,
      z: up,
    },
  };
}

export function positionToLocal(position, placement) {
  const point = ecefFromDegrees(position.lon, position.lat, position.height);

  // 接头生成器使用业务 socket 圆心作为几何端点；这里统一转到接头局部 ENU 坐标。
  return toLocal(point, placement.origin, placement.axes);
}

export function directionToLocal(direction, axes) {
  return normalize([
    dot(direction, axes.x),
    dot(direction, axes.y),
    dot(direction, axes.z),
  ]);
}
