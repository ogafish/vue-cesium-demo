const EPSILON = 1e-6;

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiplyByScalar(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function distance(a, b) {
  return magnitude(subtract(a, b));
}

function normalize(vector, fallback = [1, 0, 0]) {
  const length = magnitude(vector);

  return length > EPSILON ? multiplyByScalar(vector, 1 / length) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rotateAroundAxis(vector, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const axisDot = dot(axis, vector);
  const crossPart = cross(axis, vector);

  return add(
    add(multiplyByScalar(vector, cos), multiplyByScalar(crossPart, sin)),
    multiplyByScalar(axis, axisDot * (1 - cos)),
  );
}

export function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

export function interpolate(start, end, ratio) {
  return start + (end - start) * ratio;
}

export function makeSleeveRadii(options) {
  const startPipeOuterRadius = options.startPipeOuterRadius;
  const endPipeOuterRadius = options.endPipeOuterRadius;
  const startPipeWallThickness = options.startPipeWallThickness ?? options.wallThickness;
  const endPipeWallThickness = options.endPipeWallThickness ?? options.wallThickness;
  const maxPipeOuterRadius = Math.max(startPipeOuterRadius, endPipeOuterRadius);
  const maxPipeWallThickness = Math.max(
    startPipeWallThickness,
    endPipeWallThickness,
    options.wallThickness ?? 0,
  );
  const sleeveClearance = Math.max(maxPipeOuterRadius * 0.06, maxPipeWallThickness * 0.6, 0.02);
  const sleeveShellThickness = Math.max(maxPipeOuterRadius * 0.08, maxPipeWallThickness * 0.8, 0.03);

  return {
    startInnerRadius: startPipeOuterRadius + sleeveClearance,
    endInnerRadius: endPipeOuterRadius + sleeveClearance,
    startOuterRadius: startPipeOuterRadius + sleeveClearance + sleeveShellThickness,
    endOuterRadius: endPipeOuterRadius + sleeveClearance + sleeveShellThickness,
  };
}

export function interpolateSleeveRadius(startRadius, endRadius, ratio) {
  return interpolate(startRadius, endRadius, smoothStep(ratio));
}

function chooseFallbackAxis(chordDirection, centerOffset) {
  const offsetAxis = cross(chordDirection, centerOffset);

  if (magnitude(offsetAxis) > EPSILON) {
    return normalize(offsetAxis, [0, 0, 1]);
  }

  const fallback = Math.abs(chordDirection[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return normalize(cross(chordDirection, fallback), [0, 1, 0]);
}

function projectPointToLine(point, linePoint, lineDirection) {
  return add(
    linePoint,
    multiplyByScalar(lineDirection, dot(subtract(point, linePoint), lineDirection)),
  );
}

function makeArcFallbackPath(start, end, controlPoint, segments) {
  const points = [];

  for (let index = 0; index <= segments; index += 1) {
    const ratio = index / segments;
    const inverse = 1 - ratio;

    // 三点近似共线时退化为二次贝塞尔，仍保证弧线朝管点一侧。
    points.push(add(
      add(
        multiplyByScalar(start, inverse * inverse),
        multiplyByScalar(controlPoint, 2 * inverse * ratio),
      ),
      multiplyByScalar(end, ratio * ratio),
    ));
  }

  return points;
}

function getCircleCenterFromThreePoints(start, end, controlPoint) {
  const chord = subtract(end, start);
  const chordLength = magnitude(chord);

  if (chordLength <= EPSILON) {
    return null;
  }

  const chordDirection = normalize(chord);
  const midpoint = multiplyByScalar(add(start, end), 0.5);
  const projectedControl = projectPointToLine(controlPoint, start, chordDirection);
  const controlOffset = subtract(controlPoint, projectedControl);
  const offsetLength = magnitude(controlOffset);

  if (offsetLength <= EPSILON) {
    return null;
  }

  const halfChord = chordLength / 2;
  const sideDirection = normalize(controlOffset);
  const signedOffset = dot(subtract(controlPoint, midpoint), sideDirection);

  if (Math.abs(signedOffset) <= EPSILON) {
    return null;
  }

  const centerOffsetDistance = (signedOffset * signedOffset - halfChord * halfChord) / (2 * signedOffset);

  // 三点圆心必须落在两管夹角内侧；后续通过控制点内缩降低曲率，但不改变圆弧方向。
  return add(midpoint, multiplyByScalar(sideDirection, centerOffsetDistance));
}

function sampleArcByAngle(circleCenter, startRadiusVector, axis, angle, segments) {
  const points = [];

  for (let index = 0; index <= segments; index += 1) {
    const ratio = index / segments;
    const rotatedRadius = rotateAroundAxis(startRadiusVector, axis, angle * ratio);
    points.push(add(circleCenter, rotatedRadius));
  }

  return points;
}

function minDistanceToPoints(target, points) {
  return points.reduce((minDistance, point) => {
    const currentDistance = magnitude(subtract(target, point));

    return Math.min(minDistance, currentDistance);
  }, Number.POSITIVE_INFINITY);
}

export function sampleSocketArcCenterline(options) {
  const start = options.start;
  const end = options.end;
  const rawControlPoint = options.center;
  const segments = Math.max(3, options.segments ?? 16);
  const chord = subtract(end, start);
  const chordLength = magnitude(chord);

  if (chordLength <= EPSILON) {
    return {
      points: [start, end],
      circleCenter: rawControlPoint,
      radius: 0,
      angle: 0,
    };
  }

  const chordDirection = normalize(chord);
  const midpoint = multiplyByScalar(add(start, end), 0.5);
  const curvatureScale = clamp(
    Number.isFinite(options.curvatureScale) ? options.curvatureScale : 1,
    0.05,
    1,
  );
  const controlPoint = add(
    midpoint,
    multiplyByScalar(subtract(rawControlPoint, midpoint), curvatureScale),
  );
  const projectedControl = projectPointToLine(controlPoint, start, chordDirection);
  const controlOffset = subtract(controlPoint, projectedControl);
  const circleCenter = getCircleCenterFromThreePoints(start, end, controlPoint);

  if (!circleCenter) {
    const fallbackPoints = makeArcFallbackPath(start, end, controlPoint, segments);

    return {
      points: fallbackPoints,
      circleCenter: controlPoint,
      radius: 0,
      angle: 0,
    };
  }

  const startRadiusVector = subtract(start, circleCenter);
  const endRadiusVector = subtract(end, circleCenter);
  const radius = magnitude(startRadiusVector);
  const centerOffset = magnitude(controlOffset) > EPSILON
    ? controlOffset
    : subtract(circleCenter, midpoint);
  let axis = cross(startRadiusVector, endRadiusVector);

  if (magnitude(axis) <= EPSILON) {
    // 两端半径向量接近共线时仍生成稳定弧线，圆弧平面优先由管点相对 chord 的方向确定。
    axis = chooseFallbackAxis(chordDirection, centerOffset);
  } else {
    axis = normalize(axis);
  }

  const normalizedStartRadius = normalize(startRadiusVector);
  const normalizedEndRadius = normalize(endRadiusVector);
  const shortAngle = Math.acos(clamp(dot(normalizedStartRadius, normalizedEndRadius), -1, 1));
  const shortArc = sampleArcByAngle(circleCenter, startRadiusVector, axis, shortAngle, segments);
  const longArc = sampleArcByAngle(
    circleCenter,
    startRadiusVector,
    multiplyByScalar(axis, -1),
    Math.PI * 2 - shortAngle,
    segments,
  );
  const useShortArc = minDistanceToPoints(controlPoint, shortArc) <= minDistanceToPoints(controlPoint, longArc);
  const points = useShortArc ? shortArc : longArc;

  return {
    points,
    circleCenter,
    radius,
    angle: useShortArc ? shortAngle : Math.PI * 2 - shortAngle,
  };
}

function midpoint(first, second) {
  return multiplyByScalar(add(first, second), 0.5);
}

function sampleCatmullRomPoint(previous, start, end, next, ratio) {
  const ratio2 = ratio * ratio;
  const ratio3 = ratio2 * ratio;

  return [
    0.5 * (
      (2 * start[0]) +
      (-previous[0] + end[0]) * ratio +
      (2 * previous[0] - 5 * start[0] + 4 * end[0] - next[0]) * ratio2 +
      (-previous[0] + 3 * start[0] - 3 * end[0] + next[0]) * ratio3
    ),
    0.5 * (
      (2 * start[1]) +
      (-previous[1] + end[1]) * ratio +
      (2 * previous[1] - 5 * start[1] + 4 * end[1] - next[1]) * ratio2 +
      (-previous[1] + 3 * start[1] - 3 * end[1] + next[1]) * ratio3
    ),
    0.5 * (
      (2 * start[2]) +
      (-previous[2] + end[2]) * ratio +
      (2 * previous[2] - 5 * start[2] + 4 * end[2] - next[2]) * ratio2 +
      (-previous[2] + 3 * start[2] - 3 * end[2] + next[2]) * ratio3
    ),
  ];
}

function makeCenterCrossingSideDirection(start, end, center, frameNormal) {
  const chord = subtract(end, start);
  let side = cross(normalize(frameNormal, [0, 0, 1]), normalize(chord, [1, 0, 0]));

  if (magnitude(side) > EPSILON) {
    return normalize(side);
  }

  side = cross(normalize(subtract(start, center), [1, 0, 0]), normalize(frameNormal, [0, 0, 1]));

  return normalize(side, [0, 1, 0]);
}

export function sampleCenterCrossingPath(options) {
  const start = options.start;
  const end = options.end;
  const center = options.center ?? [0, 0, 0];
  const segments = Math.max(8, options.segments ?? 18);
  const frameNormal = normalize(options.frameNormal ?? [0, 0, 1], [0, 0, 1]);
  const startDistance = magnitude(subtract(start, center));
  const endDistance = magnitude(subtract(end, center));
  const minDistance = Math.min(startDistance, endDistance);

  if (distance(start, end) <= EPSILON || minDistance <= EPSILON) {
    return [start, center, end];
  }

  const sideDirection = makeCenterCrossingSideDirection(start, end, center, frameNormal);
  const sideOffset = minDistance * clamp(
    Number.isFinite(options.sideOffsetRatio) ? options.sideOffsetRatio : 0.18,
    0.04,
    0.35,
  );
  const anchors = [
    start,
    add(midpoint(start, center), multiplyByScalar(sideDirection, sideOffset)),
    center,
    add(midpoint(center, end), multiplyByScalar(sideDirection, sideOffset)),
    end,
  ];
  const points = [];
  const segmentCount = anchors.length - 1;
  const samplesPerSegment = Math.max(2, Math.ceil(segments / segmentCount));

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const previous = anchors[Math.max(0, segmentIndex - 1)];
    const current = anchors[segmentIndex];
    const next = anchors[segmentIndex + 1];
    const afterNext = anchors[Math.min(anchors.length - 1, segmentIndex + 2)];

    for (let sampleIndex = 0; sampleIndex <= samplesPerSegment; sampleIndex += 1) {
      if (segmentIndex > 0 && sampleIndex === 0) {
        continue;
      }

      points.push(sampleCatmullRomPoint(previous, current, next, afterNext, sampleIndex / samplesPerSegment));
    }
  }

  return points;
}

const THREE_WAY_PAIR_INDICES = [
  [0, 1],
  [0, 2],
  [1, 2],
];

export function buildThreeWayJointGeometry(options) {
  const branches = options.branches ?? [];
  const center = options.center ?? [0, 0, 0];
  const segments = Math.max(6, options.segments ?? 18);
  const curvatureScale = Number.isFinite(options.curvatureScale) ? options.curvatureScale : 0.45;

  if (branches.length !== 3) {
    throw new Error("三通连接管必须正好包含三条连接分支");
  }

  const pairs = THREE_WAY_PAIR_INDICES.map(([firstIndex, secondIndex]) => {
    const firstBranch = branches[firstIndex];
    const secondBranch = branches[secondIndex];
    const arc = sampleSocketArcCenterline({
      start: firstBranch.socketCenter,
      end: secondBranch.socketCenter,
      center,
      curvatureScale,
      segments,
    });

    return {
      firstIndex,
      secondIndex,
      path: arc.points,
    };
  });

  return {
    center,
    pairs,
  };
}
