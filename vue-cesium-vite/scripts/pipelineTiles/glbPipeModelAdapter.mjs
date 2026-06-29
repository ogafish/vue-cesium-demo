import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  GL_ARRAY_BUFFER,
  GL_ELEMENT_ARRAY_BUFFER,
  GL_FLOAT,
  createFloatBuffer,
  createIndexBuffer,
  padBuffer,
  readGlbFile,
  writeGlbFile,
} from "./glbUtils.mjs";

const GL_UNSIGNED_BYTE = 5121;
const GL_UNSIGNED_SHORT = 5123;
const GL_UNSIGNED_INT = 5125;
const TRIANGLES = 4;
const AXIS_NAMES = ["X", "Y", "Z"];
const COMPLEX_MESH_NAME_PATTERN =
  /(flange|法兰|elbow|bend|弯头|tee|wye|三通|cross|四通|valve|阀|bolt|螺栓|nut|cap|端盖|socket|joint|connector)/i;

function multiplyMatrix(a, b) {
  const result = new Array(16).fill(0);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += a[inner * 4 + row] * b[column * 4 + inner];
      }
    }
  }

  return result;
}

function identityMatrix() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function matrixFromNode(node) {
  if (Array.isArray(node.matrix)) {
    return node.matrix;
  }

  const translation = node.translation ?? [0, 0, 0];
  const scale = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  const rotation = [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ];
  const scaleMatrix = [
    scale[0], 0, 0, 0,
    0, scale[1], 0, 0,
    0, 0, scale[2], 0,
    0, 0, 0, 1,
  ];
  const matrix = multiplyMatrix(rotation, scaleMatrix);
  matrix[12] = translation[0];
  matrix[13] = translation[1];
  matrix[14] = translation[2];

  return matrix;
}

function transformPosition(matrix, position) {
  return [
    matrix[0] * position[0] + matrix[4] * position[1] + matrix[8] * position[2] + matrix[12],
    matrix[1] * position[0] + matrix[5] * position[1] + matrix[9] * position[2] + matrix[13],
    matrix[2] * position[0] + matrix[6] * position[1] + matrix[10] * position[2] + matrix[14],
  ];
}

function normalizeVector(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function transformNormal(matrix, normal) {
  // 当前适配器只做刚性/缩放后的方向变换；复杂剪切模型不会直接作为模板输出。
  return normalizeVector([
    matrix[0] * normal[0] + matrix[4] * normal[1] + matrix[8] * normal[2],
    matrix[1] * normal[0] + matrix[5] * normal[1] + matrix[9] * normal[2],
    matrix[2] * normal[0] + matrix[6] * normal[1] + matrix[10] * normal[2],
  ]);
}

function readComponent(binary, componentType, offset) {
  if (componentType === GL_FLOAT) {
    return binary.readFloatLE(offset);
  }
  if (componentType === GL_UNSIGNED_INT) {
    return binary.readUInt32LE(offset);
  }
  if (componentType === GL_UNSIGNED_SHORT) {
    return binary.readUInt16LE(offset);
  }
  if (componentType === GL_UNSIGNED_BYTE) {
    return binary.readUInt8(offset);
  }

  throw new Error(`暂不支持的 GLB accessor componentType：${componentType}`);
}

function getComponentCount(type) {
  if (type === "SCALAR") {
    return 1;
  }
  if (type === "VEC3") {
    return 3;
  }

  throw new Error(`暂不支持的 GLB accessor type：${type}`);
}

function getComponentSize(componentType) {
  if (componentType === GL_FLOAT || componentType === GL_UNSIGNED_INT) {
    return 4;
  }
  if (componentType === GL_UNSIGNED_SHORT) {
    return 2;
  }
  if (componentType === GL_UNSIGNED_BYTE) {
    return 1;
  }

  throw new Error(`暂不支持的 GLB accessor componentType：${componentType}`);
}

function readAccessorValues(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  const bufferView = gltf.bufferViews?.[accessor?.bufferView];

  if (!accessor || !bufferView) {
    throw new Error(`GLB accessor ${accessorIndex} 缺少 bufferView`);
  }

  const componentCount = getComponentCount(accessor.type);
  const componentSize = getComponentSize(accessor.componentType);
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? componentSize * componentCount;
  const values = [];

  for (let index = 0; index < accessor.count; index += 1) {
    const offset = byteOffset + index * stride;

    if (accessor.type === "VEC3") {
      values.push([
        readComponent(binary, accessor.componentType, offset),
        readComponent(binary, accessor.componentType, offset + componentSize),
        readComponent(binary, accessor.componentType, offset + componentSize * 2),
      ]);
    } else {
      values.push(readComponent(binary, accessor.componentType, offset));
    }
  }

  return values;
}

function collectScenePrimitives(gltf, binary, options = {}) {
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const primitives = [];
  const visitedNodes = new Set();
  const meshPrefix = options.meshPrefix;

  function walkNode(nodeIndex, parentMatrix) {
    if (visitedNodes.has(nodeIndex)) {
      return;
    }
    visitedNodes.add(nodeIndex);

    const node = gltf.nodes?.[nodeIndex];
    if (!node) {
      return;
    }

    const worldMatrix = multiplyMatrix(parentMatrix, matrixFromNode(node));

    if (typeof node.mesh === "number") {
      const mesh = gltf.meshes?.[node.mesh];
      const meshName = mesh?.name ?? `mesh-${node.mesh}`;
      const shouldKeep = !meshPrefix || meshName.startsWith(meshPrefix);

      if (shouldKeep) {
        for (const primitive of mesh?.primitives ?? []) {
          if (primitive.attributes?.POSITION === undefined) {
            continue;
          }

          const positions = readAccessorValues(gltf, binary, primitive.attributes.POSITION).map((position) =>
            transformPosition(worldMatrix, position),
          );
          const normals = primitive.attributes.NORMAL === undefined
            ? null
            : readAccessorValues(gltf, binary, primitive.attributes.NORMAL).map((normal) =>
                transformNormal(worldMatrix, normal),
              );
          const indices = primitive.indices === undefined
            ? positions.map((_, index) => index)
            : readAccessorValues(gltf, binary, primitive.indices);

          primitives.push({
            meshName,
            nodeName: node.name ?? `node-${nodeIndex}`,
            materialIndex: primitive.material ?? 0,
            mode: primitive.mode ?? TRIANGLES,
            positions,
            normals,
            indices,
          });
        }
      }
    }

    for (const child of node.children ?? []) {
      walkNode(child, worldMatrix);
    }
  }

  for (const rootNode of scene?.nodes ?? []) {
    walkNode(rootNode, identityMatrix());
  }

  return primitives;
}

function computeBounds(primitives) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const primitive of primitives) {
    for (const position of primitive.positions) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], position[axis]);
        max[axis] = Math.max(max[axis], position[axis]);
      }
    }
  }

  return { min, max };
}

function analyzeBounds(bounds) {
  const extents = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const lengthAxis = extents.indexOf(Math.max(...extents));
  const radialAxes = [0, 1, 2].filter((axis) => axis !== lengthAxis);
  const sourceLength = extents[lengthAxis];
  const radialDiameters = radialAxes.map((axis) => extents[axis]);
  const sourceRadius = Math.max(...radialDiameters) / 2;
  const minRadialDiameter = Math.min(...radialDiameters);
  const maxRadialDiameter = Math.max(...radialDiameters);

  return {
    extents,
    lengthAxis,
    radialAxes,
    sourceLength,
    sourceRadius,
    radialSymmetry: maxRadialDiameter > 0 ? minRadialDiameter / maxRadialDiameter : 0,
    lengthToDiameter: maxRadialDiameter > 0 ? sourceLength / maxRadialDiameter : 0,
    center: bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2),
  };
}

function colorFactorToHex(baseColorFactor) {
  const values = baseColorFactor.slice(0, 3).map((value) => {
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    return Math.round(clamped * 255).toString(16).padStart(2, "0");
  });

  return `#${values.join("")}`;
}

function simplifyMaterial(material, index) {
  const pbr = material?.pbrMetallicRoughness ?? {};
  const baseColorFactor = pbr.baseColorFactor ?? [1, 1, 1, 1];

  return {
    name: material?.name ?? `material-${index}`,
    doubleSided: material?.doubleSided ?? true,
    pbrMetallicRoughness: {
      baseColorFactor,
      metallicFactor: pbr.metallicFactor ?? 0,
      roughnessFactor: pbr.roughnessFactor ?? 0.8,
    },
  };
}

function createMaterialProfile(gltf, primitives, sourcePath, id, mode) {
  const materialWeights = new Map();

  for (const primitive of primitives) {
    materialWeights.set(
      primitive.materialIndex,
      (materialWeights.get(primitive.materialIndex) ?? 0) + primitive.positions.length,
    );
  }

  const primaryMaterialIndex = [...materialWeights.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0;
  const material = gltf.materials?.[primaryMaterialIndex] ?? {};
  const pbr = material.pbrMetallicRoughness ?? {};
  const baseColorFactor = pbr.baseColorFactor ?? [1, 1, 1, 1];

  return {
    id,
    mode,
    sourcePath,
    sourceFile: basename(sourcePath),
    material: {
      name: material.name ?? `${id} material`,
      color: colorFactorToHex(baseColorFactor),
      baseColorFactor,
      metallicFactor: pbr.metallicFactor ?? 0,
      roughnessFactor: pbr.roughnessFactor ?? 0.8,
      doubleSided: material.doubleSided ?? true,
      sourceMaterialIndex: primaryMaterialIndex,
      hasTextureReferences: Boolean(
        pbr.baseColorTexture ||
          pbr.metallicRoughnessTexture ||
          material.normalTexture ||
          material.occlusionTexture ||
          material.emissiveTexture,
      ),
    },
  };
}

function assessTemplateCompatibility(primitives, allPrimitives, analysis, options) {
  const reasons = [];
  const sourceFile = basename(options.sourcePath ?? "");
  const searchableNames = [
    sourceFile,
    ...allPrimitives.flatMap((primitive) => [primitive.meshName, primitive.nodeName]),
  ];

  if (!options.allowTemplate) {
    reasons.push("未显式允许模板输出，默认只提取材质风格");
  }
  if (options.styleOnly) {
    reasons.push("用户指定 style-only，本次不输出可缩放模板");
  }
  if (primitives.length === 0) {
    reasons.push("未找到可作为直管主体的 mesh primitive");
  }
  if (primitives.some((primitive) => primitive.mode !== TRIANGLES)) {
    reasons.push("存在非 TRIANGLES primitive");
  }
  if (primitives.some((primitive) => !primitive.normals)) {
    reasons.push("存在缺少 NORMAL 的 primitive");
  }
  if (searchableNames.some((name) => COMPLEX_MESH_NAME_PATTERN.test(name))) {
    reasons.push("文件名、节点名或 mesh 名称包含端盖/法兰/弯头/阀门等复杂管件特征，不直接拉伸");
  }
  if (!Number.isFinite(analysis.sourceLength) || analysis.sourceLength <= 0) {
    reasons.push("长轴尺寸无效");
  }
  if (!Number.isFinite(analysis.sourceRadius) || analysis.sourceRadius <= 0) {
    reasons.push("半径尺寸无效");
  }
  if (analysis.radialSymmetry < 0.45) {
    reasons.push("径向包围盒差异过大，不像标准圆管主体");
  }
  if (analysis.lengthToDiameter < 1.2) {
    reasons.push("长径比过小，不适合作为直管模板缩放");
  }

  return {
    canUseTemplate: reasons.length === 0,
    reasons,
  };
}

function normalizeTemplatePrimitives(primitives, analysis) {
  const { center, lengthAxis, radialAxes, sourceLength, sourceRadius } = analysis;

  return primitives.map((primitive) => ({
    ...primitive,
    // 模板约定：局部 X 是长度方向，局部 Y/Z 是半径方向，长度和半径都归一化为 1。
    positions: primitive.positions.map((position) => [
      (position[lengthAxis] - center[lengthAxis]) / sourceLength,
      (position[radialAxes[0]] - center[radialAxes[0]]) / sourceRadius,
      (position[radialAxes[1]] - center[radialAxes[1]]) / sourceRadius,
    ]),
    normals: primitive.normals.map((normal) =>
      normalizeVector([normal[lengthAxis], normal[radialAxes[0]], normal[radialAxes[1]]]),
    ),
  }));
}

function buildTemplateGlb(sourceGltf, normalizedPrimitives) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  const meshPrimitives = [];
  const materials = sourceGltf.materials?.length
    ? sourceGltf.materials.map(simplifyMaterial)
    : [simplifyMaterial(null, 0)];
  let byteOffset = 0;

  function appendBufferView(buffer, target) {
    const padded = padBuffer(buffer);
    const viewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: buffer.length,
      target,
    });
    buffers.push(padded);
    byteOffset += padded.length;
    return viewIndex;
  }

  for (const primitive of normalizedPrimitives) {
    const flatPositions = primitive.positions.flat();
    const flatNormals = primitive.normals.flat();
    const indexData = createIndexBuffer(primitive.indices);
    const positionView = appendBufferView(createFloatBuffer(flatPositions), GL_ARRAY_BUFFER);
    const normalView = appendBufferView(createFloatBuffer(flatNormals), GL_ARRAY_BUFFER);
    const indexView = appendBufferView(indexData.buffer, GL_ELEMENT_ARRAY_BUFFER);
    const positionAccessor = accessors.length;
    const primitiveBounds = computeBounds([{ positions: primitive.positions }]);

    accessors.push({
      bufferView: positionView,
      byteOffset: 0,
      componentType: GL_FLOAT,
      count: primitive.positions.length,
      type: "VEC3",
      min: primitiveBounds.min,
      max: primitiveBounds.max,
    });

    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      byteOffset: 0,
      componentType: GL_FLOAT,
      count: primitive.normals.length,
      type: "VEC3",
    });

    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      byteOffset: 0,
      componentType: indexData.componentType,
      count: primitive.indices.length,
      type: "SCALAR",
    });

    meshPrimitives.push({
      attributes: {
        POSITION: positionAccessor,
        NORMAL: normalAccessor,
      },
      indices: indexAccessor,
      material: Math.min(primitive.materialIndex, materials.length - 1),
    });
  }

  return {
    gltf: {
      asset: {
        version: "2.0",
        generator: "vue-cesium-vite GLB pipe model adapter",
      },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: "standard-straight-pipe-template" }],
      meshes: [{ name: "standard-straight-pipe-template", primitives: meshPrimitives }],
      materials,
      buffers: [{ byteLength: byteOffset }],
      bufferViews,
      accessors,
    },
    binary: Buffer.concat(buffers),
  };
}

export async function adaptPipeGlbModel(options) {
  const {
    sourcePath,
    id,
    outputDir,
    meshPrefix,
    styleOnly = false,
    allowTemplate = false,
    templateFileName = `${id}.template.glb`,
    profileFileName = `${id}.profile.json`,
    metaFileName = `${id}.template.meta.json`,
    reportFileName = `${id}.adapter-report.json`,
  } = options;

  const { gltf, binary } = await readGlbFile(sourcePath);
  const allPrimitives = collectScenePrimitives(gltf, binary);
  const templatePrimitives = meshPrefix
    ? collectScenePrimitives(gltf, binary, { meshPrefix })
    : allPrimitives;
  const profileSourcePrimitives = templatePrimitives.length > 0 ? templatePrimitives : allPrimitives;
  const bounds = templatePrimitives.length > 0
    ? computeBounds(templatePrimitives)
    : { min: [0, 0, 0], max: [0, 0, 0] };
  const analysis = analyzeBounds(bounds);
  const compatibility = assessTemplateCompatibility(templatePrimitives, allPrimitives, analysis, {
    meshPrefix,
    styleOnly,
    allowTemplate,
    sourcePath,
  });
  const mode = compatibility.canUseTemplate ? "template" : "procedural-style";
  const profile = createMaterialProfile(gltf, profileSourcePrimitives, sourcePath, id, mode);
  const metadata = {
    id,
    mode,
    sourcePath,
    sourceMeshPrefix: meshPrefix ?? null,
    sourceLength: analysis.sourceLength,
    sourceRadius: analysis.sourceRadius,
    sourceCenter: analysis.center,
    sourceAxis: AXIS_NAMES[analysis.lengthAxis],
    templateLength: compatibility.canUseTemplate ? 1 : null,
    templateRadius: compatibility.canUseTemplate ? 1 : null,
  };
  const report = {
    id,
    mode,
    canUseTemplate: compatibility.canUseTemplate,
    reasons: compatibility.reasons,
    primitiveCount: templatePrimitives.length,
    totalPrimitiveCount: allPrimitives.length,
    meshNames: [...new Set(allPrimitives.map((primitive) => primitive.meshName))],
    analysis: {
      extents: analysis.extents,
      sourceAxis: AXIS_NAMES[analysis.lengthAxis],
      sourceLength: analysis.sourceLength,
      sourceRadius: analysis.sourceRadius,
      radialSymmetry: analysis.radialSymmetry,
      lengthToDiameter: analysis.lengthToDiameter,
    },
    material: profile.material,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/${profileFileName}`, JSON.stringify(profile, null, 2));
  await writeFile(`${outputDir}/${reportFileName}`, JSON.stringify(report, null, 2));

  if (compatibility.canUseTemplate) {
    const normalizedPrimitives = normalizeTemplatePrimitives(templatePrimitives, analysis);
    const template = buildTemplateGlb(gltf, normalizedPrimitives);

    await writeGlbFile(`${outputDir}/${templateFileName}`, template.gltf, template.binary);
    await writeFile(`${outputDir}/${metaFileName}`, JSON.stringify(metadata, null, 2));
  }

  return {
    mode,
    profile,
    metadata,
    report,
    outputDir,
    templatePath: compatibility.canUseTemplate ? `${outputDir}/${templateFileName}` : null,
    profilePath: `${outputDir}/${profileFileName}`,
    reportPath: `${outputDir}/${reportFileName}`,
    metaPath: compatibility.canUseTemplate ? `${outputDir}/${metaFileName}` : null,
  };
}

export function getDefaultOutputDir(sourcePath) {
  return dirname(sourcePath);
}
