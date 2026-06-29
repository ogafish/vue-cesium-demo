import {
  add,
  cross,
  distance,
  dot,
  magnitude,
  multiplyByScalar,
  normalize,
  subtract,
} from "../../src/utils/pipelineBendMath.js";
import {
  buildThreeWayJointGeometry,
  interpolateSleeveRadius,
  makeSleeveRadii,
  sampleSocketArcCenterline,
} from "../../src/utils/pipelineJointArcGeometry.js";

function pushVertex(positions, normals, x, y, z, nx, ny, nz) {
  positions.push(x, y, z);
  const length = Math.hypot(nx, ny, nz) || 1;
  normals.push(nx / length, ny / length, nz / length);
}

function appendMesh(target, source) {
  const vertexOffset = target.positions.length / 3;

  target.positions.push(...source.positions);
  target.normals.push(...source.normals);
  target.indices.push(...source.indices.map((index) => index + vertexOffset));

  for (let index = 0; index < source.positions.length; index += 3) {
    updateBounds(target.bounds, source.positions[index], source.positions[index + 1], source.positions[index + 2]);
  }
}

function createEmptyMeshBuilder() {
  return {
    positions: [],
    normals: [],
    indices: [],
    bounds: {
      min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    },
  };
}

function validatePipeSection(options) {
  const outerRadius = options.outerRadius;
  const wallThickness = options.wallThickness;
  const innerRadius = outerRadius - wallThickness;

  if (outerRadius <= 0 || innerRadius <= 0) {
    throw new Error("管线外半径和内半径必须大于 0");
  }

  if (wallThickness >= outerRadius) {
    throw new Error("管壁厚度必须小于外半径");
  }

  return innerRadius;
}

function buildSphereMesh(options) {
  const radius = options.radius;
  const radialSegments = options.radialSegments ?? 32;
  const heightSegments = Math.max(12, Math.floor(radialSegments / 2));
  const positions = [];
  const normals = [];
  const indices = [];
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };

  for (let row = 0; row <= heightSegments; row += 1) {
    const v = row / heightSegments;
    const phi = Math.PI * v;
    const z = Math.cos(phi);
    const ringRadius = Math.sin(phi);

    for (let column = 0; column <= radialSegments; column += 1) {
      const u = column / radialSegments;
      const theta = Math.PI * 2 * u;
      const nx = Math.cos(theta) * ringRadius;
      const ny = Math.sin(theta) * ringRadius;
      const nz = z;
      const x = nx * radius;
      const y = ny * radius;
      const localZ = nz * radius;

      pushVertex(positions, normals, x, y, localZ, nx, ny, nz);
      updateBounds(bounds, x, y, localZ);
    }
  }

  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < radialSegments; column += 1) {
      const a = row * (radialSegments + 1) + column;
      const b = a + radialSegments + 1;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  return {
    positions,
    normals,
    indices,
    min: bounds.min,
    max: bounds.max,
  };
}

function updateBounds(bounds, x, y, z) {
  bounds.min[0] = Math.min(bounds.min[0], x);
  bounds.min[1] = Math.min(bounds.min[1], y);
  bounds.min[2] = Math.min(bounds.min[2], z);
  bounds.max[0] = Math.max(bounds.max[0], x);
  bounds.max[1] = Math.max(bounds.max[1], y);
  bounds.max[2] = Math.max(bounds.max[2], z);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getStraightPipeLengthSegments(pipeLength, outerRadius, requestedSegments) {
  if (Number.isFinite(requestedSegments)) {
    return Math.max(1, Math.floor(requestedSegments));
  }

  const targetSegmentLength = Math.max(outerRadius * 5.5, 0.7);

  // 长度分段只服务视觉细节，做上限保护，避免长管线把 b3dm 体积放大过多。
  return clamp(Math.ceil(pipeLength / targetSegmentLength), 8, 32);
}

function getStraightPipeBevel(options) {
  const pipeLength = options.pipeLength;
  const outerRadius = options.outerRadius;
  const wallThickness = options.wallThickness;
  const depth = Math.min(outerRadius * 0.055, wallThickness * 0.35, 0.045);
  const length = Math.min(outerRadius * 0.18, pipeLength * 0.04, 0.08);

  if (depth <= 1e-5 || length <= 1e-5 || pipeLength <= length * 2.5) {
    return { depth: 0, length: 0 };
  }

  return { depth, length };
}

function getStraightPipeSurfaceOffset(ratio, angle, outerRadius, enabled = true) {
  if (!enabled) {
    return 0;
  }

  const amplitude = Math.min(outerRadius * 0.012, 0.012);
  const edgeFade = Math.sin(Math.PI * clamp(ratio, 0, 1));
  const axialWave = Math.sin(ratio * Math.PI * 10);
  const circumferentialWave = Math.sin(angle * 6 + ratio * Math.PI * 4);

  // 低频细节只制造高光层次，幅度严格受控，避免近景看成变形管。
  return amplitude * edgeFade * (axialWave * 0.65 + circumferentialWave * 0.35);
}

function buildRoundPipeMeshAlongPath(options) {
  const path = options.path;
  const outerRadius = options.outerRadius;
  const wallThickness = options.wallThickness;
  const innerRadius = validatePipeSection(options);
  const radialSegments = options.radialSegments ?? 48;
  const frameNormal = normalize(options.frameNormal ?? [0, 0, 1], [0, 0, 1]);
  const capStart = options.capStart ?? true;
  const capEnd = options.capEnd ?? true;

  if (path.length < 2) {
    throw new Error("管线路径至少需要两个中心点");
  }

  const positions = [];
  const normals = [];
  const indices = [];
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };

  function addQuad(a, b, c, d) {
    indices.push(a, b, c, a, c, d);
  }

  const frames = makePathFrames(path, frameNormal);

  for (let ringIndex = 0; ringIndex < path.length; ringIndex += 1) {
    const center = path[ringIndex];
    const { yAxis, zAxis } = frames[ringIndex];

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const angle = (Math.PI * 2 * segmentIndex) / radialSegments;
      const radialDirection = normalize(
        add(
          multiplyByScalar(yAxis, Math.cos(angle)),
          multiplyByScalar(zAxis, Math.sin(angle)),
        ),
      );
      const outer = add(center, multiplyByScalar(radialDirection, outerRadius));
      const inner = add(center, multiplyByScalar(radialDirection, innerRadius));

      pushVertex(positions, normals, outer[0], outer[1], outer[2], radialDirection[0], radialDirection[1], radialDirection[2]);
      pushVertex(positions, normals, inner[0], inner[1], inner[2], -radialDirection[0], -radialDirection[1], -radialDirection[2]);
      updateBounds(bounds, outer[0], outer[1], outer[2]);
      updateBounds(bounds, inner[0], inner[1], inner[2]);
    }
  }

  for (let ringIndex = 0; ringIndex < path.length - 1; ringIndex += 1) {
    const currentRing = ringIndex * radialSegments * 2;
    const nextRing = (ringIndex + 1) * radialSegments * 2;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;
      const outerA = currentRing + segmentIndex * 2;
      const outerB = currentRing + nextSegment * 2;
      const outerC = nextRing + nextSegment * 2;
      const outerD = nextRing + segmentIndex * 2;
      const innerA = currentRing + segmentIndex * 2 + 1;
      const innerB = nextRing + segmentIndex * 2 + 1;
      const innerC = nextRing + nextSegment * 2 + 1;
      const innerD = currentRing + nextSegment * 2 + 1;

      addQuad(outerA, outerB, outerC, outerD);
      addQuad(innerA, innerB, innerC, innerD);
    }
  }

  if (capStart || capEnd) {
    const firstRing = 0;
    const lastRing = (path.length - 1) * radialSegments * 2;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;

      if (capStart) {
        addQuad(
          firstRing + nextSegment * 2,
          firstRing + segmentIndex * 2,
          firstRing + segmentIndex * 2 + 1,
          firstRing + nextSegment * 2 + 1,
        );
      }

      if (capEnd) {
        addQuad(
          lastRing + segmentIndex * 2,
          lastRing + nextSegment * 2,
          lastRing + nextSegment * 2 + 1,
          lastRing + segmentIndex * 2 + 1,
        );
      }
    }
  }

  const length = path.slice(1).reduce(
    (sum, point, index) => sum + distance(path[index], point),
    0,
  );

  return {
    positions,
    normals,
    indices,
    min: bounds.min,
    max: bounds.max,
    length,
  };
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function interpolate(start, end, ratio) {
  return start + (end - start) * ratio;
}

function buildTaperedSleeveMesh(options) {
  const start = options.start;
  const end = options.end;
  const radialSegments = options.radialSegments ?? 48;
  const lengthSegments = Math.max(4, options.lengthSegments ?? 10);
  const frameNormal = normalize(options.frameNormal ?? [0, 0, 1], [0, 0, 1]);
  const pipeVector = subtract(end, start);
  const sleeveLength = magnitude(pipeVector);
  const startPipeOuterRadius = options.startPipeOuterRadius;
  const endPipeOuterRadius = options.endPipeOuterRadius;
  const startPipeWallThickness = options.startPipeWallThickness ?? options.wallThickness;
  const endPipeWallThickness = options.endPipeWallThickness ?? options.wallThickness;
  const radii = makeSleeveRadii({
    ...options,
    startPipeWallThickness,
    endPipeWallThickness,
  });

  if (sleeveLength <= 0) {
    throw new Error("一字套筒连接管两端 socket 圆心不能重合");
  }

  if (startPipeOuterRadius <= 0 || endPipeOuterRadius <= 0) {
    throw new Error("一字套筒连接管两端管径必须大于 0");
  }

  const tangent = normalize(pipeVector);
  let zAxis = subtract(frameNormal, multiplyByScalar(tangent, dot(frameNormal, tangent)));

  if (magnitude(zAxis) < 1e-6) {
    const fallbackNormal = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    zAxis = subtract(fallbackNormal, multiplyByScalar(tangent, dot(fallbackNormal, tangent)));
  }

  zAxis = normalize(zAxis, [0, 0, 1]);
  const yAxis = normalize(cross(zAxis, tangent), [0, 1, 0]);
  const positions = [];
  const normals = [];
  const indices = [];
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };

  function addQuad(a, b, c, d) {
    indices.push(a, b, c, a, c, d);
  }

  for (let ringIndex = 0; ringIndex <= lengthSegments; ringIndex += 1) {
    const rawRatio = ringIndex / lengthSegments;
    const radiusRatio = smoothStep(rawRatio);
    const center = add(start, multiplyByScalar(pipeVector, rawRatio));
    const outerRadius = interpolate(radii.startOuterRadius, radii.endOuterRadius, radiusRatio);
    const innerRadius = interpolate(radii.startInnerRadius, radii.endInnerRadius, radiusRatio);

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const angle = (Math.PI * 2 * segmentIndex) / radialSegments;
      const radialDirection = normalize(
        add(
          multiplyByScalar(yAxis, Math.cos(angle)),
          multiplyByScalar(zAxis, Math.sin(angle)),
        ),
      );
      const outer = add(center, multiplyByScalar(radialDirection, outerRadius));
      const inner = add(center, multiplyByScalar(radialDirection, innerRadius));

      pushVertex(positions, normals, outer[0], outer[1], outer[2], radialDirection[0], radialDirection[1], radialDirection[2]);
      pushVertex(positions, normals, inner[0], inner[1], inner[2], -radialDirection[0], -radialDirection[1], -radialDirection[2]);
      updateBounds(bounds, outer[0], outer[1], outer[2]);
      updateBounds(bounds, inner[0], inner[1], inner[2]);
    }
  }

  for (let ringIndex = 0; ringIndex < lengthSegments; ringIndex += 1) {
    const currentRing = ringIndex * radialSegments * 2;
    const nextRing = (ringIndex + 1) * radialSegments * 2;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;
      const outerA = currentRing + segmentIndex * 2;
      const outerB = currentRing + nextSegment * 2;
      const outerC = nextRing + nextSegment * 2;
      const outerD = nextRing + segmentIndex * 2;
      const innerA = currentRing + segmentIndex * 2 + 1;
      const innerB = nextRing + segmentIndex * 2 + 1;
      const innerC = nextRing + nextSegment * 2 + 1;
      const innerD = currentRing + nextSegment * 2 + 1;

      addQuad(outerA, outerB, outerC, outerD);
      addQuad(innerA, innerB, innerC, innerD);
    }
  }

  const firstRing = 0;
  const lastRing = lengthSegments * radialSegments * 2;
  for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
    const nextSegment = (segmentIndex + 1) % radialSegments;

    // 套筒端面只封外半径和内半径之间的环形管壁，保留中间孔洞来表达“包裹管线”。
    addQuad(
      firstRing + nextSegment * 2,
      firstRing + segmentIndex * 2,
      firstRing + segmentIndex * 2 + 1,
      firstRing + nextSegment * 2 + 1,
    );
    addQuad(
      lastRing + segmentIndex * 2,
      lastRing + nextSegment * 2,
      lastRing + nextSegment * 2 + 1,
      lastRing + segmentIndex * 2 + 1,
    );
  }

  return {
    positions,
    normals,
    indices,
    min: bounds.min,
    max: bounds.max,
    length: sleeveLength,
  };
}

function makeFrameFromTangent(tangent, preferredNormal) {
  let zAxis = subtract(preferredNormal, multiplyByScalar(tangent, dot(preferredNormal, tangent)));

  if (magnitude(zAxis) < 1e-6) {
    const fallbackNormal = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    zAxis = subtract(fallbackNormal, multiplyByScalar(tangent, dot(fallbackNormal, tangent)));
  }

  zAxis = normalize(zAxis, [0, 0, 1]);
  const yAxis = normalize(cross(zAxis, tangent), [0, 1, 0]);

  return { yAxis, zAxis };
}

function makePathFrames(path, preferredNormal) {
  const tangents = path.map((_, index) => {
    if (index === 0) {
      return normalize(subtract(path[1], path[0]));
    }

    if (index === path.length - 1) {
      return normalize(subtract(path[index], path[index - 1]));
    }

    return normalize(subtract(path[index + 1], path[index - 1]));
  });
  const frames = [];
  let previousFrame = makeFrameFromTangent(tangents[0], preferredNormal);

  frames.push(previousFrame);

  for (let index = 1; index < tangents.length; index += 1) {
    const tangent = tangents[index];
    let zAxis = subtract(previousFrame.zAxis, multiplyByScalar(tangent, dot(previousFrame.zAxis, tangent)));

    if (magnitude(zAxis) < 1e-6) {
      zAxis = subtract(previousFrame.yAxis, multiplyByScalar(tangent, dot(previousFrame.yAxis, tangent)));
    }

    if (magnitude(zAxis) < 1e-6) {
      previousFrame = makeFrameFromTangent(tangent, preferredNormal);
      frames.push(previousFrame);
      continue;
    }

    zAxis = normalize(zAxis, [0, 0, 1]);
    let yAxis = normalize(cross(zAxis, tangent), [0, 1, 0]);

    // 沿圆弧扫掠时延续上一截面的朝向，避免相机拖动时看到法线翻转造成的条状高光。
    if (dot(yAxis, previousFrame.yAxis) < 0) {
      yAxis = multiplyByScalar(yAxis, -1);
      zAxis = multiplyByScalar(zAxis, -1);
    }

    previousFrame = { yAxis, zAxis };
    frames.push(previousFrame);
  }

  return frames;
}

function buildTaperedSleeveMeshAlongPath(options) {
  const path = options.path;
  const radialSegments = options.radialSegments ?? 48;
  const frameNormal = normalize(options.frameNormal ?? [0, 0, 1], [0, 0, 1]);
  const capStart = options.capStart ?? true;
  const capEnd = options.capEnd ?? true;
  const radii = makeSleeveRadii(options);

  if (path.length < 2) {
    throw new Error("连接套筒圆弧路径至少需要两个中心点");
  }

  const positions = [];
  const normals = [];
  const indices = [];
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  const cumulativeLengths = [0];

  for (let index = 1; index < path.length; index += 1) {
    cumulativeLengths.push(cumulativeLengths[index - 1] + distance(path[index - 1], path[index]));
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1];
  if (totalLength <= 0) {
    throw new Error("连接套筒圆弧路径长度必须大于 0");
  }

  function addQuad(a, b, c, d) {
    indices.push(a, b, c, a, c, d);
  }

  const frames = makePathFrames(path, frameNormal);

  for (let ringIndex = 0; ringIndex < path.length; ringIndex += 1) {
    const center = path[ringIndex];
    const ratio = cumulativeLengths[ringIndex] / totalLength;
    const outerRadius = interpolateSleeveRadius(radii.startOuterRadius, radii.endOuterRadius, ratio);
    const innerRadius = interpolateSleeveRadius(radii.startInnerRadius, radii.endInnerRadius, ratio);
    const { yAxis, zAxis } = frames[ringIndex];

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const angle = (Math.PI * 2 * segmentIndex) / radialSegments;
      const radialDirection = normalize(
        add(
          multiplyByScalar(yAxis, Math.cos(angle)),
          multiplyByScalar(zAxis, Math.sin(angle)),
        ),
      );
      const outer = add(center, multiplyByScalar(radialDirection, outerRadius));
      const inner = add(center, multiplyByScalar(radialDirection, innerRadius));

      pushVertex(positions, normals, outer[0], outer[1], outer[2], radialDirection[0], radialDirection[1], radialDirection[2]);
      pushVertex(positions, normals, inner[0], inner[1], inner[2], -radialDirection[0], -radialDirection[1], -radialDirection[2]);
      updateBounds(bounds, outer[0], outer[1], outer[2]);
      updateBounds(bounds, inner[0], inner[1], inner[2]);
    }
  }

  for (let ringIndex = 0; ringIndex < path.length - 1; ringIndex += 1) {
    const currentRing = ringIndex * radialSegments * 2;
    const nextRing = (ringIndex + 1) * radialSegments * 2;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;
      const outerA = currentRing + segmentIndex * 2;
      const outerB = currentRing + nextSegment * 2;
      const outerC = nextRing + nextSegment * 2;
      const outerD = nextRing + segmentIndex * 2;
      const innerA = currentRing + segmentIndex * 2 + 1;
      const innerB = nextRing + segmentIndex * 2 + 1;
      const innerC = nextRing + nextSegment * 2 + 1;
      const innerD = currentRing + nextSegment * 2 + 1;

      addQuad(outerA, outerB, outerC, outerD);
      addQuad(innerA, innerB, innerC, innerD);
    }
  }

  if (capStart || capEnd) {
    const firstRing = 0;
    const lastRing = (path.length - 1) * radialSegments * 2;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;

      if (capStart) {
        // 套筒端面只封闭管壁环带，保留中间孔洞来包裹两端直管。
        addQuad(
          firstRing + nextSegment * 2,
          firstRing + segmentIndex * 2,
          firstRing + segmentIndex * 2 + 1,
          firstRing + nextSegment * 2 + 1,
        );
      }

      if (capEnd) {
        addQuad(
          lastRing + segmentIndex * 2,
          lastRing + nextSegment * 2,
          lastRing + nextSegment * 2 + 1,
          lastRing + segmentIndex * 2 + 1,
        );
      }
    }
  }

  return {
    positions,
    normals,
    indices,
    min: bounds.min,
    max: bounds.max,
    length: totalLength,
  };
}

export function buildStraightRoundPipeMesh(options) {
  const pipeLength = options.length;
  const outerRadius = options.outerRadius;
  const wallThickness = options.wallThickness;
  const innerRadius = outerRadius - wallThickness;
  const radialSegments = options.radialSegments ?? 48;
  const lengthSegments = getStraightPipeLengthSegments(pipeLength, outerRadius, options.lengthSegments);

  if (pipeLength <= 0) {
    throw new Error("管线长度必须大于 0");
  }

  if (outerRadius <= 0 || innerRadius <= 0) {
    throw new Error("管线外半径和内半径必须大于 0");
  }

  if (wallThickness >= outerRadius) {
    throw new Error("管壁厚度必须小于外半径");
  }

  const positions = [];
  const normals = [];
  const texcoords = [];
  const indices = [];
  const halfLength = pipeLength / 2;
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  const bevel = getStraightPipeBevel({ pipeLength, outerRadius, wallThickness });
  const rings = [];

  function addQuad(a, b, c, d) {
    // glTF 使用三角面，四边形管壁需要拆成两个三角形。
    indices.push(a, b, c, a, c, d);
  }

  function addRing(x, isCapRing = false) {
    rings.push({
      x,
      isCapRing,
      ratio: clamp((x + halfLength) / pipeLength, 0, 1),
    });
  }

  if (bevel.length > 0) {
    const bodyStart = -halfLength + bevel.length;
    const bodyEnd = halfLength - bevel.length;

    addRing(-halfLength, true);
    addRing(bodyStart);
    for (let index = 1; index < lengthSegments; index += 1) {
      addRing(bodyStart + ((bodyEnd - bodyStart) * index) / lengthSegments);
    }
    addRing(bodyEnd);
    addRing(halfLength, true);
  } else {
    for (let index = 0; index <= lengthSegments; index += 1) {
      addRing(-halfLength + (pipeLength * index) / lengthSegments);
    }
  }

  function getOuterRadiusAt(ring, angle) {
    if (ring.isCapRing) {
      return outerRadius - bevel.depth;
    }

    return outerRadius + getStraightPipeSurfaceOffset(ring.ratio, angle, outerRadius, options.surfaceDetail !== false);
  }

  function getInnerRadiusAt(ring) {
    return ring.isCapRing ? innerRadius + bevel.depth : innerRadius;
  }

  function getRadiusDerivative(ringIndex, angle, radiusGetter) {
    const previous = rings[Math.max(0, ringIndex - 1)];
    const next = rings[Math.min(rings.length - 1, ringIndex + 1)];
    const dx = next.x - previous.x;

    if (Math.abs(dx) < 1e-6) {
      return 0;
    }

    return (radiusGetter(next, angle) - radiusGetter(previous, angle)) / dx;
  }

  function pushPipeUv(ring, segmentIndex) {
    const repeatLength = Math.max(outerRadius * 8, 1);
    const u = (ring.x + halfLength) / repeatLength;
    const v = segmentIndex / radialSegments;
    texcoords.push(u, v);
  }

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const angle = (Math.PI * 2 * segmentIndex) / radialSegments;
      const radialY = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const outer = getOuterRadiusAt(ring, angle);
      const inner = getInnerRadiusAt(ring);
      const outerSlope = getRadiusDerivative(ringIndex, angle, getOuterRadiusAt);
      const innerSlope = getRadiusDerivative(ringIndex, angle, getInnerRadiusAt);
      const outerY = radialY * outer;
      const outerZ = radialZ * outer;
      const innerY = radialY * inner;
      const innerZ = radialZ * inner;

      pushVertex(positions, normals, ring.x, outerY, outerZ, -outerSlope, radialY, radialZ);
      pushPipeUv(ring, segmentIndex);
      pushVertex(positions, normals, ring.x, innerY, innerZ, innerSlope, -radialY, -radialZ);
      pushPipeUv(ring, segmentIndex);
      updateBounds(bounds, ring.x, outerY, outerZ);
      updateBounds(bounds, ring.x, innerY, innerZ);
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const currentRing = ringIndex * radialSegments * 2;
    const nextRing = (ringIndex + 1) * radialSegments * 2;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;
      const outerA = currentRing + segmentIndex * 2;
      const outerB = currentRing + nextSegment * 2;
      const outerC = nextRing + nextSegment * 2;
      const outerD = nextRing + segmentIndex * 2;
      const innerA = currentRing + segmentIndex * 2 + 1;
      const innerB = nextRing + segmentIndex * 2 + 1;
      const innerC = nextRing + nextSegment * 2 + 1;
      const innerD = currentRing + nextSegment * 2 + 1;

      addQuad(outerA, outerB, outerC, outerD);
      addQuad(innerA, innerB, innerC, innerD);
    }
  }

  function appendEndCap(ring, normalX, isStart) {
    const capStart = positions.length / 3;

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const angle = (Math.PI * 2 * segmentIndex) / radialSegments;
      const radialY = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const outer = getOuterRadiusAt(ring, angle);
      const inner = getInnerRadiusAt(ring);
      const outerY = radialY * outer;
      const outerZ = radialZ * outer;
      const innerY = radialY * inner;
      const innerZ = radialZ * inner;

      pushVertex(positions, normals, ring.x, outerY, outerZ, normalX, 0, 0);
      pushPipeUv(ring, segmentIndex);
      pushVertex(positions, normals, ring.x, innerY, innerZ, normalX, 0, 0);
      pushPipeUv(ring, segmentIndex);
      updateBounds(bounds, ring.x, outerY, outerZ);
      updateBounds(bounds, ring.x, innerY, innerZ);
    }

    for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex += 1) {
      const nextSegment = (segmentIndex + 1) % radialSegments;

      if (isStart) {
        addQuad(
          capStart + nextSegment * 2,
          capStart + segmentIndex * 2,
          capStart + segmentIndex * 2 + 1,
          capStart + nextSegment * 2 + 1,
        );
      } else {
        addQuad(
          capStart + segmentIndex * 2,
          capStart + nextSegment * 2,
          capStart + nextSegment * 2 + 1,
          capStart + segmentIndex * 2 + 1,
        );
      }
    }
  }

  appendEndCap(rings[0], -1, true);
  appendEndCap(rings[rings.length - 1], 1, false);

  return {
    positions,
    normals,
    texcoords,
    indices,
    min: bounds.min,
    max: bounds.max,
  };
}

export function buildJointRoundPipeMesh(options) {
  const outerRadius = options.outerRadius;
  const wallThickness = options.wallThickness;
  const radialSegments = options.radialSegments ?? 48;
  const branchLength = options.branchLength;
  const jointKind = options.jointKind;
  const branches = options.branches ?? [];
  const mesh = createEmptyMeshBuilder();
  const hubRadius = Math.max(outerRadius * 1.15, outerRadius + wallThickness * 1.5);
  const socketReserveLength = options.socketLength ?? branchLength;

  validatePipeSection(options);

  if (branches.length < 2) {
    throw new Error("接头至少需要两条连接分支");
  }

  function makeBranchDirection(branch) {
    if (Array.isArray(branch.direction)) {
      return normalize(branch.direction);
    }

    return normalize([branch.direction.x, branch.direction.y, branch.direction.z]);
  }

  // 二次贝塞尔接头暂时停用：控制点不等于曲线必经点，曾导致 3D Tiles 接头没有真正经过业务节点。
  // function makeSocketQuadraticPath(firstDirection, secondDirection, reserveLength) { ... }

  // 外偏圆弧算法暂时停用：它在局部坐标中可能把接头整体偏离业务节点，导致 entity 正确但 3D Tiles 错位。
  // 后续如果要恢复严格圆弧，应先把 socket 切点、圆心和 tileset transform 的验证用例补齐。
  // function makeCircularFilletPath(firstDirection, secondDirection) { ... }

  function getBranchSocketCenter(branch, direction) {
    // socketCenter 来自前端业务切点；缺失时才回退到旧的 direction * socketLength 推断。
    return Array.isArray(branch.socketCenter)
      ? branch.socketCenter
      : multiplyByScalar(direction, socketReserveLength);
  }

  function makeStraightSleeveMesh(firstBranch, secondBranch, firstDirection, secondDirection) {
    const firstSocketCenter = getBranchSocketCenter(firstBranch, firstDirection);
    const secondSocketCenter = getBranchSocketCenter(secondBranch, secondDirection);

    // 一字直通不再用中心球体遮缝，而是直接连接两段直管回退后的圆心，并按两端管径连续变径。
    return buildTaperedSleeveMesh({
      start: firstSocketCenter,
      end: secondSocketCenter,
      frameNormal: options.frameNormal,
      startPipeOuterRadius: firstBranch.outerRadius ?? outerRadius,
      endPipeOuterRadius: secondBranch.outerRadius ?? outerRadius,
      startPipeWallThickness: firstBranch.wallThickness ?? wallThickness,
      endPipeWallThickness: secondBranch.wallThickness ?? wallThickness,
      wallThickness,
      radialSegments,
      lengthSegments: 12,
    });
  }

  function makeSmoothArcSleeveMesh(firstBranch, secondBranch, firstDirection, secondDirection) {
    const firstSocketCenter = getBranchSocketCenter(firstBranch, firstDirection);
    const secondSocketCenter = getBranchSocketCenter(secondBranch, secondDirection);
    const arc = sampleSocketArcCenterline({
      start: firstSocketCenter,
      end: secondSocketCenter,
      center: [0, 0, 0],
      curvatureScale: 0.45,
      segments: 28,
    });

    // 平滑连接头用两端 socket 圆心和节点附近圆心生成圆弧，再沿圆弧扫掠变径空心套筒。
    return buildTaperedSleeveMeshAlongPath({
      path: arc.points,
      frameNormal: options.frameNormal,
      startPipeOuterRadius: firstBranch.outerRadius ?? outerRadius,
      endPipeOuterRadius: secondBranch.outerRadius ?? outerRadius,
      startPipeWallThickness: firstBranch.wallThickness ?? wallThickness,
      endPipeWallThickness: secondBranch.wallThickness ?? wallThickness,
      wallThickness,
      radialSegments,
    });
  }

  function appendThreeWaySleeveMesh() {
    const threeWayBranches = branches.map((branch) => {
      const direction = makeBranchDirection(branch);

      return {
        ...branch,
        direction,
        socketCenter: getBranchSocketCenter(branch, direction),
        outerRadius: branch.outerRadius ?? outerRadius,
        wallThickness: branch.wallThickness ?? wallThickness,
      };
    });
    const threeWayGeometry = buildThreeWayJointGeometry({
      branches: threeWayBranches,
      center: [0, 0, 0],
      curvatureScale: 0.45,
      segments: 28,
    });

    function appendSleevePath(path, startPipeOuterRadius, endPipeOuterRadius, startPipeWallThickness, endPipeWallThickness) {
      if (path.length < 2) {
        return;
      }

      appendMesh(mesh, buildTaperedSleeveMeshAlongPath({
        path,
        frameNormal: options.frameNormal,
        startPipeOuterRadius,
        endPipeOuterRadius,
        startPipeWallThickness,
        endPipeWallThickness,
        wallThickness,
        radialSegments,
        // 三通由多段套筒组成，内部端面保持开放，避免中心融合处出现封口盘。
        capStart: false,
        capEnd: false,
      }));
    }

    for (const pair of threeWayGeometry.pairs) {
      const firstBranch = threeWayBranches[pair.firstIndex];
      const secondBranch = threeWayBranches[pair.secondIndex];

      // 三通演示方案只保留三根完整弯管，中心重叠暂不遮盖。
      appendSleevePath(
        pair.path,
        firstBranch.outerRadius,
        secondBranch.outerRadius,
        firstBranch.wallThickness,
        secondBranch.wallThickness,
      );
    }
  }

  function appendFourWaySleeveMesh() {
    const fourWayBranches = branches.map((branch) => {
      const direction = makeBranchDirection(branch);

      return {
        ...branch,
        direction,
        socketCenter: getBranchSocketCenter(branch, direction),
        outerRadius: branch.outerRadius ?? outerRadius,
        wallThickness: branch.wallThickness ?? wallThickness,
      };
    });
    const maxBranchOuterRadius = Math.max(...fourWayBranches.map((branch) => branch.outerRadius));
    const maxBranchWallThickness = Math.max(...fourWayBranches.map((branch) => branch.wallThickness));
    const fourWayHubRadius = Math.max(
      maxBranchOuterRadius * 1.12,
      maxBranchOuterRadius + maxBranchWallThickness * 0.6,
    );

    appendMesh(mesh, buildSphereMesh({
      radius: fourWayHubRadius,
      radialSegments: Math.max(32, Math.floor(radialSegments / 2)),
    }));

    for (const branch of fourWayBranches) {
      appendMesh(mesh, buildTaperedSleeveMesh({
        start: multiplyByScalar(branch.direction, -fourWayHubRadius * 0.18),
        end: branch.socketCenter,
        frameNormal: options.frameNormal,
        startPipeOuterRadius: branch.outerRadius,
        endPipeOuterRadius: branch.outerRadius,
        startPipeWallThickness: branch.wallThickness,
        endPipeWallThickness: branch.wallThickness,
        wallThickness,
        radialSegments,
        lengthSegments: 8,
      }));
    }
  }

  if (branches.length === 2) {
    const firstDirection = makeBranchDirection(branches[0]);
    const secondDirection = makeBranchDirection(branches[1]);

    if (jointKind === "straight") {
      appendMesh(mesh, makeStraightSleeveMesh(branches[0], branches[1], firstDirection, secondDirection));
    } else if (jointKind === "uBend") {
      appendMesh(mesh, makeSmoothArcSleeveMesh(branches[0], branches[1], firstDirection, secondDirection));
    } else {
      // 两分支只允许一字直通和平滑圆弧；旧占位接头已清理，错误配置必须显式失败。
      throw new Error(`不支持的两分支连接管类型：${jointKind}`);
    }

    return {
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      min: mesh.bounds.min,
      max: mesh.bounds.max,
      length: branchLength,
    };
  }

  if (jointKind === "threeWay" && branches.length === 3) {
    appendThreeWaySleeveMesh();

    return {
      positions: mesh.positions,
      normals: mesh.normals,
      texcoords: mesh.texcoords,
      indices: mesh.indices,
      min: mesh.bounds.min,
      max: mesh.bounds.max,
      length: branchLength,
    };
  }

  if (jointKind === "fourWay" && branches.length === 4) {
    appendFourWaySleeveMesh();

    return {
      positions: mesh.positions,
      normals: mesh.normals,
      texcoords: mesh.texcoords,
      indices: mesh.indices,
      min: mesh.bounds.min,
      max: mesh.bounds.max,
      length: branchLength,
    };
  }

  if (jointKind !== "multi") {
    throw new Error(`不支持的连接头类型：${jointKind}`);
  }

  // 多通暂时仍使用旧 fallback；四通已经由 fourWay 专用中心球加四根直套筒路径接管。
  appendMesh(mesh, buildSphereMesh({
    radius: hubRadius,
    radialSegments: Math.max(32, Math.floor(radialSegments / 2)),
  }));

  for (const branch of branches) {
    const direction = makeBranchDirection(branch);
    const start = multiplyByScalar(direction, -hubRadius * 0.12);
    const end = multiplyByScalar(direction, branchLength);

    // 每个分支生成一段短圆管，和中心球体轻微重叠，避免接头与主管之间露缝。
    appendMesh(mesh, buildRoundPipeMeshAlongPath({
      path: [start, end],
      frameNormal: options.frameNormal,
      outerRadius,
      wallThickness,
      radialSegments,
      capStart: false,
      capEnd: false,
    }));
  }

  return {
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    min: mesh.bounds.min,
    max: mesh.bounds.max,
    length: branchLength,
  };
}
