import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  createFloatBuffer,
  createGlbFromChunks,
  createIndexBuffer,
  padBuffer,
  readGlbFile,
} from "./glbUtils.mjs";
import {
  buildJointPlacement,
  buildPipePlacement,
  directionToLocal,
  positionToLocal,
} from "./pipeMath.mjs";
import {
  buildJointRoundPipeMesh,
  buildStraightRoundPipeMesh,
} from "./pipeMesh.mjs";
import {
  getPipeModelConfig,
  getPipeModelMaterialProfile,
  mergeMaterialWithModelStyle,
  normalizeModelId,
  shouldUseTemplatePipeModel,
} from "./modelRegistry.mjs";

const Z_UP_TO_GLTF_Y_UP_MATRIX = [
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
];

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = PNG_CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  const crcBuffer = Buffer.alloc(4);
  const payload = Buffer.concat([typeBuffer, data]);

  lengthBuffer.writeUInt32BE(data.length, 0);
  crcBuffer.writeUInt32BE(crc32(payload), 0);

  return Buffer.concat([lengthBuffer, payload, crcBuffer]);
}

function createPngDataUri(width, height, pixelFactory) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelFactory(x / width, y / height, x, y);
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const png = Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", deflateSync(raw)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString("base64")}`;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function toByte(value) {
  return Math.round(clamp01(value) * 255);
}

function mixValue(a, b, t) {
  return a + (b - a) * clamp01(t);
}

function mixColor(a, b, t) {
  const weight = clamp01(t);
  return [
    mixValue(a[0], b[0], weight),
    mixValue(a[1], b[1], weight),
    mixValue(a[2], b[2], weight),
  ];
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hashNoise(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function isCarbonSteelPreset(preset) {
  return preset === "carbon-steel-new"
    || preset === "carbon-steel-light-rust"
    || preset === "carbon-steel-heavy-rust";
}

function isDetailedProceduralPreset(preset) {
  return isCarbonSteelPreset(preset)
    || preset === "hdpe-black-gas"
    || preset === "ductile-iron-epoxy"
    || preset === "frp-sand-pipe"
    || preset === "galvanized-steel";
}

function getTextureResolution(material, fallback = 128) {
  const resolution = Math.round(Number(material.textureResolution ?? fallback));

  return Math.min(512, Math.max(64, resolution));
}

function getStyleNumber(material, key, fallback) {
  const value = Number(material[key]);

  return Number.isFinite(value) ? value : fallback;
}

function getCarbonSteelRustLevel(material) {
  const explicit = Number(material.rustLevel);
  if (Number.isFinite(explicit)) {
    return clamp01(explicit);
  }

  if (material.texturePreset === "carbon-steel-heavy-rust") {
    return 0.78;
  }

  if (material.texturePreset === "carbon-steel-light-rust") {
    return 0.3;
  }

  return 0.06;
}

function getWeldMask(u, strength = 1) {
  const first = Math.abs(u - 0.18);
  const second = Math.abs(u - 0.68);
  const nearest = Math.min(first, second);

  return (1 - smoothstep(0.008, 0.04, nearest)) * clamp01(strength);
}

function getCarbonSteelRustMask(u, v, x, y, material) {
  const level = getCarbonSteelRustLevel(material);
  const largePatch = hashNoise(Math.floor(u * 12), Math.floor(v * 9), 31);
  const mediumPatch = hashNoise(Math.floor(u * 42), Math.floor(v * 30), 37);
  const pit = hashNoise(x, y, 43);
  const runoff = Math.max(0, Math.sin(u * Math.PI * 5.5 + mediumPatch * 4)) * 0.16;
  const patchThreshold = 1 - level * 0.72;
  const patchMask = smoothstep(patchThreshold, 1, largePatch * 0.68 + mediumPatch * 0.32 + runoff);
  const pitMask = smoothstep(1 - level * 0.45, 1, pit);

  return clamp01(patchMask * (0.55 + level * 0.45) + pitMask * level * 0.36);
}

function getCarbonSteelOilMask(u, v, x, y, material) {
  const level = getCarbonSteelRustLevel(material);
  const oilStrength = getStyleNumber(material, "oilStainStrength", 0.08 + level * 0.16);
  const stain = hashNoise(Math.floor(u * 7), Math.floor(v * 14), 53);
  const streak = Math.max(0, Math.sin((v + hashNoise(x, y, 59) * 0.25) * Math.PI * 6));

  return smoothstep(0.68, 1, stain * 0.8 + streak * 0.2) * oilStrength;
}

function makeProceduralBaseColorTexture(material, pixelFactory, fallbackResolution = 192) {
  const size = getTextureResolution(material, fallbackResolution);

  return {
    uri: createPngDataUri(size, size, pixelFactory),
  };
}

function getFineSurfaceMask(u, v, x, y, material) {
  const frequency = getStyleNumber(material, "textureFrequency", 20);
  const microNoise = getStyleNumber(material, "microNoiseStrength", 0.08);
  const bandStrength = getStyleNumber(material, "circumferentialBandStrength", 0.03);
  const axial = Math.sin(u * Math.PI * 2 * frequency) * microNoise;
  const ring = Math.sin(v * Math.PI * 2 * Math.max(3, frequency * 0.45)) * bandStrength;
  const noise = (hashNoise(x, y, 13) - 0.5) * microNoise;

  return axial + ring + noise;
}

function makeCarbonSteelBaseColorTexture(material) {
  return makeProceduralBaseColorTexture(material, (u, v, x, y) => {
    const fineNoise = hashNoise(x, y, 61) - 0.5;
    const grainFrequency = getStyleNumber(material, "rollingGrainFrequency", 34);
    const weldStrength = getStyleNumber(material, "weldStrength", 1);
    const axialGrain = Math.sin(u * Math.PI * 2 * grainFrequency + fineNoise * 0.8) * 0.018;
    const steelBase = [
      0.62 + axialGrain + fineNoise * 0.035,
      0.64 + axialGrain + fineNoise * 0.03,
      0.63 + axialGrain + fineNoise * 0.025,
    ];
    const rust = getCarbonSteelRustMask(u, v, x, y, material);
    const oil = getCarbonSteelOilMask(u, v, x, y, material);
    const weld = getWeldMask(u, weldStrength);
    const orangeRust = [0.74, 0.31, 0.08];
    const darkRust = [0.26, 0.13, 0.06];
    const rustTone = mixColor(orangeRust, darkRust, rust * 0.62 + hashNoise(x, y, 67) * 0.16);
    const weldHeat = [0.88, 0.67, 0.35];
    let color = mixColor(steelBase, rustTone, rust);

    color = mixColor(color, [0.08, 0.075, 0.065], oil);
    color = mixColor(color, weldHeat, weld * 0.32);

    return [toByte(color[0]), toByte(color[1]), toByte(color[2]), 255];
  }, 256);
}

function makeHdpeBaseColorTexture(material) {
  return makeProceduralBaseColorTexture(material, (u, v, x, y) => {
    const surface = getFineSurfaceMask(u, v, x, y, material);
    const stripeStrength = getStyleNumber(material, "axialStripeStrength", 0.42);
    const stripeFrequency = Math.max(1, getStyleNumber(material, "stripeFrequency", 4));
    const stripeCenter = Math.abs((v * stripeFrequency) % 1 - 0.5);
    const stripe = (1 - smoothstep(0.03, 0.12, stripeCenter)) * stripeStrength;
    const base = [0.018 + surface * 0.35, 0.02 + surface * 0.32, 0.018 + surface * 0.28];
    const yellowStripe = [0.92, 0.62, 0.08];
    const color = mixColor(base, yellowStripe, stripe);

    return [toByte(color[0]), toByte(color[1]), toByte(color[2]), 255];
  }, 160);
}

function makeDuctileIronBaseColorTexture(material) {
  return makeProceduralBaseColorTexture(material, (u, v, x, y) => {
    const surface = getFineSurfaceMask(u, v, x, y, material);
    const pitting = smoothstep(
      1 - getStyleNumber(material, "pittingStrength", 0.2),
      1,
      hashNoise(Math.floor(u * 52), Math.floor(v * 52), 101),
    );
    const wear = smoothstep(
      1 - getStyleNumber(material, "coatingWearStrength", 0.14),
      1,
      hashNoise(Math.floor(u * 18), Math.floor(v * 14), 103),
    );
    const epoxyBase = [0.16 + surface * 0.25, 0.24 + surface * 0.22, 0.2 + surface * 0.2];
    const exposedIron = [0.12, 0.12, 0.11];
    let color = mixColor(epoxyBase, exposedIron, wear * 0.7);

    color = mixColor(color, [0.04, 0.05, 0.045], pitting * 0.28);

    return [toByte(color[0]), toByte(color[1]), toByte(color[2]), 255];
  }, 192);
}

function makeFrpBaseColorTexture(material) {
  return makeProceduralBaseColorTexture(material, (u, v, x, y) => {
    const fiberStrength = getStyleNumber(material, "fiberStrength", 0.36);
    const sandStrength = getStyleNumber(material, "sandGrainStrength", 0.22);
    const diagonalA = Math.sin((u * 18 + v * 8) * Math.PI * 2);
    const diagonalB = Math.sin((u * 15 - v * 10) * Math.PI * 2);
    const fiber = (diagonalA * 0.5 + diagonalB * 0.5) * fiberStrength;
    const sand = (hashNoise(x, y, 109) - 0.5) * sandStrength;
    const base = [
      0.52 + fiber * 0.08 + sand * 0.28,
      0.45 + fiber * 0.06 + sand * 0.24,
      0.34 + fiber * 0.04 + sand * 0.18,
    ];

    return [toByte(base[0]), toByte(base[1]), toByte(base[2]), 255];
  }, 192);
}

function makeGalvanizedBaseColorTexture(material) {
  return makeProceduralBaseColorTexture(material, (u, v, x, y) => {
    const crystalStrength = getStyleNumber(material, "zincCrystalStrength", 0.28);
    const seamStrength = getStyleNumber(material, "seamStrength", 0.36);
    const cellA = hashNoise(Math.floor(u * 24), Math.floor(v * 24), 113);
    const cellB = hashNoise(Math.floor(u * 40), Math.floor(v * 40), 127);
    const crystal = (cellA * 0.7 + cellB * 0.3 - 0.5) * crystalStrength;
    const seam = (1 - smoothstep(0.008, 0.05, Math.abs(v - 0.5))) * seamStrength;
    const base = [0.64 + crystal, 0.66 + crystal * 0.92, 0.65 + crystal * 0.84];
    const color = mixColor(base, [0.48, 0.5, 0.48], seam * 0.55);

    return [toByte(color[0]), toByte(color[1]), toByte(color[2]), 255];
  }, 256);
}

function makeMetallicRoughnessTexture(material) {
  if (!material.texturePreset) {
    return null;
  }

  const size = getTextureResolution(material, isDetailedProceduralPreset(material.texturePreset) ? 192 : 128);
  const baseMetallic = clamp01(Number(material.metallicFactor ?? 0.08));
  const baseRoughness = clamp01(Number(material.roughnessFactor ?? 0.55));
  const preset = material.texturePreset;
  const uri = createPngDataUri(size, size, (u, v, x, y) => {
    const frequency = getStyleNumber(material, "textureFrequency", 18);
    const axial = Math.sin(u * Math.PI * 2 * frequency);
    const ring = Math.sin(v * Math.PI * 2 * Math.max(3, frequency * 0.5));
    const noise = hashNoise(x, y, 13);
    let roughness = baseRoughness;
    let metallic = baseMetallic;

    if (preset === "pvc-fine") {
      roughness += getFineSurfaceMask(u, v, x, y, material) * 0.5 + axial * 0.025 + ring * 0.014;
      metallic *= 0.25;
    } else if (preset === "matte-coated") {
      roughness += getFineSurfaceMask(u, v, x, y, material) * 0.52 + axial * 0.018 + ring * 0.02;
      metallic *= 0.35;
    } else if (isCarbonSteelPreset(preset)) {
      const rust = getCarbonSteelRustMask(u, v, x, y, material);
      const oil = getCarbonSteelOilMask(u, v, x, y, material);
      const weld = getWeldMask(u, getStyleNumber(material, "weldStrength", 1));
      const wear = smoothstep(0.78, 1, hashNoise(Math.floor(u * 64), Math.floor(v * 64), 71));

      metallic = mixValue(0.9, 0.08, rust);
      metallic = mixValue(metallic, 0.42, weld * 0.35);
      roughness = mixValue(baseRoughness, 0.88, rust);
      roughness = mixValue(roughness, 0.58, weld * 0.55);
      roughness += wear * 0.08 + oil * 0.12 + (noise - 0.5) * 0.035;
    } else if (preset === "hdpe-black-gas") {
      const stripe = smoothstep(0.82, 1, Math.sin(v * Math.PI * 2 * getStyleNumber(material, "stripeFrequency", 4)) * 0.5 + 0.5);

      metallic = 0;
      roughness += getFineSurfaceMask(u, v, x, y, material) * 0.45 + stripe * 0.035;
    } else if (preset === "ductile-iron-epoxy") {
      const pitting = smoothstep(
        1 - getStyleNumber(material, "pittingStrength", 0.2),
        1,
        hashNoise(Math.floor(u * 52), Math.floor(v * 52), 101),
      );
      const wear = smoothstep(
        1 - getStyleNumber(material, "coatingWearStrength", 0.14),
        1,
        hashNoise(Math.floor(u * 18), Math.floor(v * 14), 103),
      );

      metallic = mixValue(baseMetallic, 0.48, wear);
      roughness += pitting * 0.18 + wear * 0.1 + getFineSurfaceMask(u, v, x, y, material) * 0.34;
    } else if (preset === "frp-sand-pipe") {
      const fiber = Math.abs(Math.sin((u * 18 + v * 8) * Math.PI * 2)) * getStyleNumber(material, "fiberStrength", 0.36);
      const sand = hashNoise(x, y, 109) * getStyleNumber(material, "sandGrainStrength", 0.22);

      metallic = 0;
      roughness += fiber * 0.12 + sand * 0.22 + (noise - 0.5) * 0.025;
    } else if (preset === "galvanized-steel") {
      const crystal = hashNoise(Math.floor(u * 24), Math.floor(v * 24), 113) * getStyleNumber(
        material,
        "zincCrystalStrength",
        0.28,
      );
      const seam = (1 - smoothstep(0.008, 0.05, Math.abs(v - 0.5))) * getStyleNumber(
        material,
        "seamStrength",
        0.36,
      );

      metallic = clamp01(baseMetallic - crystal * 0.18 - seam * 0.08);
      roughness += crystal * 0.2 + seam * 0.12 + (noise - 0.5) * 0.025;
    }

    return [
      255,
      toByte(roughness),
      toByte(metallic),
      255,
    ];
  });

  return { uri };
}

function makeCarbonSteelNormalTexture(material) {
  const size = getTextureResolution(material, 256);
  const rustLevel = getCarbonSteelRustLevel(material);
  const weldStrength = getStyleNumber(material, "weldStrength", 1);
  const uri = createPngDataUri(size, size, (u, v, x, y) => {
    const rolling = Math.sin(v * Math.PI * 2 * 88) * 0.028;
    const axialGroove = Math.sin(u * Math.PI * 2 * 28) * 0.018;
    const weld = getWeldMask(u, weldStrength);
    const pit = getCarbonSteelRustMask(u, v, x, y, material) * rustLevel;
    const randomPit = (hashNoise(x, y, 83) - 0.5) * pit * 0.34;
    const nx = rolling + randomPit;
    const ny = axialGroove + weld * 0.2 - pit * 0.08;
    const nz = 1;
    const length = Math.hypot(nx, ny, nz) || 1;

    return [
      toByte(nx / length * 0.5 + 0.5),
      toByte(ny / length * 0.5 + 0.5),
      toByte(nz / length * 0.5 + 0.5),
      255,
    ];
  });

  return { uri };
}

function makeProceduralNormalTexture(material) {
  const size = getTextureResolution(material, 160);
  const preset = material.texturePreset;
  const uri = createPngDataUri(size, size, (u, v, x, y) => {
    const frequency = getStyleNumber(material, "textureFrequency", 20);
    const surface = getFineSurfaceMask(u, v, x, y, material);
    let nx = Math.sin(u * Math.PI * 2 * frequency) * surface * 0.28;
    let ny = Math.sin(v * Math.PI * 2 * Math.max(3, frequency * 0.5)) * surface * 0.2;

    if (preset === "hdpe-black-gas") {
      const stripe = (1 - smoothstep(0.03, 0.12, Math.abs((v * getStyleNumber(material, "stripeFrequency", 4)) % 1 - 0.5)));
      ny += stripe * 0.05;
    } else if (preset === "ductile-iron-epoxy") {
      const pitting = smoothstep(
        1 - getStyleNumber(material, "pittingStrength", 0.2),
        1,
        hashNoise(Math.floor(u * 52), Math.floor(v * 52), 101),
      );
      nx += (hashNoise(x, y, 131) - 0.5) * pitting * 0.3;
      ny -= pitting * 0.12;
    } else if (preset === "frp-sand-pipe") {
      nx += Math.sin((u * 18 + v * 8) * Math.PI * 2) * getStyleNumber(material, "fiberStrength", 0.36) * 0.12;
      ny += (hashNoise(x, y, 109) - 0.5) * getStyleNumber(material, "sandGrainStrength", 0.22) * 0.35;
    } else if (preset === "galvanized-steel") {
      const crystal = (hashNoise(Math.floor(u * 24), Math.floor(v * 24), 113) - 0.5) * getStyleNumber(
        material,
        "zincCrystalStrength",
        0.28,
      );
      nx += crystal * 0.32;
      ny -= (1 - smoothstep(0.008, 0.05, Math.abs(v - 0.5))) * 0.08;
    }

    const nz = 1;
    const length = Math.hypot(nx, ny, nz) || 1;

    return [
      toByte(nx / length * 0.5 + 0.5),
      toByte(ny / length * 0.5 + 0.5),
      toByte(nz / length * 0.5 + 0.5),
      255,
    ];
  });

  return { uri };
}

function makeCarbonSteelOcclusionTexture(material) {
  const size = getTextureResolution(material, 256);
  const uri = createPngDataUri(size, size, (u, v, x, y) => {
    const rust = getCarbonSteelRustMask(u, v, x, y, material);
    const weld = getWeldMask(u, getStyleNumber(material, "weldStrength", 1));
    const seam = 1 - smoothstep(0.006, 0.03, Math.abs(v - 0.5));
    const occlusion = 1 - rust * 0.28 - weld * 0.18 - seam * 0.08;
    const value = toByte(occlusion);

    return [value, value, value, 255];
  });

  return { uri };
}

function makeProceduralOcclusionTexture(material) {
  const size = getTextureResolution(material, 160);
  const preset = material.texturePreset;
  const uri = createPngDataUri(size, size, (u, v, x, y) => {
    let occlusion = 1 - Math.abs(getFineSurfaceMask(u, v, x, y, material)) * 0.22;

    if (preset === "ductile-iron-epoxy") {
      const pitting = smoothstep(
        1 - getStyleNumber(material, "pittingStrength", 0.2),
        1,
        hashNoise(Math.floor(u * 52), Math.floor(v * 52), 101),
      );
      occlusion -= pitting * 0.18;
    } else if (preset === "frp-sand-pipe") {
      occlusion -= hashNoise(x, y, 109) * getStyleNumber(material, "sandGrainStrength", 0.22) * 0.16;
    } else if (preset === "galvanized-steel") {
      occlusion -= (1 - smoothstep(0.008, 0.05, Math.abs(v - 0.5))) * getStyleNumber(
        material,
        "seamStrength",
        0.36,
      ) * 0.12;
    }

    const value = toByte(occlusion);

    return [value, value, value, 255];
  });

  return { uri };
}

function makeCarbonSteelEmissiveTexture(material) {
  const width = 128;
  const height = 128;
  const uri = createPngDataUri(width, height, (u, v, x, y) => {
    const weld = getWeldMask(u, getStyleNumber(material, "weldStrength", 1));
    const heatFlicker = hashNoise(x, y, 97) * 0.12;
    const heat = clamp01(weld * 0.45 + heatFlicker);

    return [toByte(heat), toByte(heat * 0.42), toByte(heat * 0.08), 255];
  });

  return { uri };
}

function makeMaterialTextureSet(material) {
  if (!material.texturePreset) {
    return {};
  }

  if (isCarbonSteelPreset(material.texturePreset)) {
    return {
      baseColor: makeCarbonSteelBaseColorTexture(material),
      metallicRoughness: makeMetallicRoughnessTexture(material),
      normal: makeCarbonSteelNormalTexture(material),
      occlusion: makeCarbonSteelOcclusionTexture(material),
      emissive: makeCarbonSteelEmissiveTexture(material),
    };
  }

  if (material.texturePreset === "hdpe-black-gas") {
    return {
      baseColor: makeHdpeBaseColorTexture(material),
      metallicRoughness: makeMetallicRoughnessTexture(material),
      normal: makeProceduralNormalTexture(material),
      occlusion: makeProceduralOcclusionTexture(material),
    };
  }

  if (material.texturePreset === "ductile-iron-epoxy") {
    return {
      baseColor: makeDuctileIronBaseColorTexture(material),
      metallicRoughness: makeMetallicRoughnessTexture(material),
      normal: makeProceduralNormalTexture(material),
      occlusion: makeProceduralOcclusionTexture(material),
    };
  }

  if (material.texturePreset === "frp-sand-pipe") {
    return {
      baseColor: makeFrpBaseColorTexture(material),
      metallicRoughness: makeMetallicRoughnessTexture(material),
      normal: makeProceduralNormalTexture(material),
      occlusion: makeProceduralOcclusionTexture(material),
    };
  }

  if (material.texturePreset === "galvanized-steel") {
    return {
      baseColor: makeGalvanizedBaseColorTexture(material),
      metallicRoughness: makeMetallicRoughnessTexture(material),
      normal: makeProceduralNormalTexture(material),
      occlusion: makeProceduralOcclusionTexture(material),
    };
  }

  return {
    metallicRoughness: makeMetallicRoughnessTexture(material),
    normal: makeProceduralNormalTexture(material),
    occlusion: makeProceduralOcclusionTexture(material),
  };
}

function hexToBaseColorFactor(hexColor = "#00c7ff") {
  const normalized = hexColor.trim().replace("#", "");
  const full = normalized.length === 3
    ? normalized.split("").map((value) => value + value).join("")
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return [0, 0.78, 1, 1];
  }

  return [
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
    1,
  ];
}

function getBaseColorFactor(material) {
  if (Array.isArray(material.baseColorFactor) && material.baseColorFactor.length >= 3) {
    return [
      Number(material.baseColorFactor[0]) || 0,
      Number(material.baseColorFactor[1]) || 0,
      Number(material.baseColorFactor[2]) || 0,
      material.baseColorFactor[3] === undefined ? 1 : Number(material.baseColorFactor[3]) || 0,
    ];
  }

  return hexToBaseColorFactor(material.color);
}

function createFallbackTexcoords(mesh) {
  const vertexCount = mesh.positions.length / 3;
  const texcoords = [];
  const min = mesh.min ?? [0, 0, 0];
  const max = mesh.max ?? [1, 1, 1];
  const spanX = Math.max(1e-6, max[0] - min[0]);
  const spanY = Math.max(1e-6, max[1] - min[1]);
  const spanZ = Math.max(1e-6, max[2] - min[2]);
  const dominantSpan = Math.max(spanX, spanY, spanZ);

  for (let index = 0; index < vertexCount; index += 1) {
    const x = mesh.positions[index * 3];
    const y = mesh.positions[index * 3 + 1];
    const z = mesh.positions[index * 3 + 2];
    const u = (x - min[0]) / dominantSpan;
    const angle = Math.atan2(z, y);
    const v = (angle + Math.PI) / (Math.PI * 2);

    texcoords.push(u, v);
  }

  return texcoords;
}

function createGlb(mesh, material) {
  const vertexCount = mesh.positions.length / 3;
  const meshTexcoords = Array.isArray(mesh.texcoords) && mesh.texcoords.length === vertexCount * 2
    ? mesh.texcoords
    : createFallbackTexcoords(mesh);
  const hasTexcoords = meshTexcoords.length === vertexCount * 2;
  const materialTextureSet = hasTexcoords ? makeMaterialTextureSet(material) : {};
  const textureImages = [];
  const textureEntries = [];
  const textureIndices = {};

  function registerTexture(slotName, texture) {
    if (!texture) {
      return;
    }

    const imageIndex = textureImages.length;
    const textureIndex = textureEntries.length;
    textureImages.push({ uri: texture.uri });
    textureEntries.push({ sampler: 0, source: imageIndex });
    textureIndices[slotName] = textureIndex;
  }

  registerTexture("baseColor", materialTextureSet.baseColor);
  registerTexture("metallicRoughness", materialTextureSet.metallicRoughness);
  registerTexture("normal", materialTextureSet.normal);
  registerTexture("occlusion", materialTextureSet.occlusion);
  registerTexture("emissive", materialTextureSet.emissive);

  const positionBuffer = padBuffer(createFloatBuffer(mesh.positions));
  const normalBuffer = padBuffer(createFloatBuffer(mesh.normals));
  const texcoordBuffer = hasTexcoords ? padBuffer(createFloatBuffer(meshTexcoords)) : null;
  const indexData = createIndexBuffer(mesh.indices);
  const indexBuffer = padBuffer(indexData.buffer);

  const positionOffset = 0;
  const normalOffset = positionOffset + positionBuffer.length;
  const texcoordOffset = normalOffset + normalBuffer.length;
  const indexOffset = texcoordOffset + (texcoordBuffer?.length ?? 0);
  const binaryBuffer = Buffer.concat([
    positionBuffer,
    normalBuffer,
    ...(texcoordBuffer ? [texcoordBuffer] : []),
    indexBuffer,
  ]);
  const positionAccessorIndex = 0;
  const normalAccessorIndex = 1;
  const texcoordAccessorIndex = hasTexcoords ? 2 : null;
  const indexAccessorIndex = hasTexcoords ? 3 : 2;
  const primitiveAttributes = { POSITION: positionAccessorIndex, NORMAL: normalAccessorIndex };
  if (texcoordAccessorIndex !== null) {
    primitiveAttributes.TEXCOORD_0 = texcoordAccessorIndex;
  }
  const pbrMetallicRoughness = {
    baseColorFactor: getBaseColorFactor(material),
    metallicFactor: textureIndices.metallicRoughness !== undefined ? 1 : material.metallicFactor ?? 0.12,
    roughnessFactor: textureIndices.metallicRoughness !== undefined ? 1 : material.roughnessFactor ?? 0.34,
  };
  if (textureIndices.baseColor !== undefined) {
    pbrMetallicRoughness.baseColorTexture = { index: textureIndices.baseColor };
  }
  if (textureIndices.metallicRoughness !== undefined) {
    pbrMetallicRoughness.metallicRoughnessTexture = { index: textureIndices.metallicRoughness };
  }

  const materialDefinition = {
    name: material.name ?? "pipeline material",
    doubleSided: material.doubleSided ?? true,
    pbrMetallicRoughness,
  };
  if (textureIndices.normal !== undefined) {
    materialDefinition.normalTexture = {
      index: textureIndices.normal,
      scale: Number(material.normalScale ?? 1),
    };
  }
  if (textureIndices.occlusion !== undefined) {
    materialDefinition.occlusionTexture = {
      index: textureIndices.occlusion,
      strength: Number(material.occlusionStrength ?? 1),
    };
  }
  if (textureIndices.emissive !== undefined) {
    materialDefinition.emissiveTexture = { index: textureIndices.emissive };
    materialDefinition.emissiveFactor = Array.isArray(material.emissiveFactor)
      ? material.emissiveFactor.slice(0, 3).map((value) => Number(value) || 0)
      : [0, 0, 0];
  }

  const gltf = {
    asset: { version: "2.0", generator: "vue-cesium-vite pipeline tiles generator" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        // 程序化 mesh 以 3D Tiles 局部 Z-up 生成；glTF 规范是 Y-up。
        // 这里先转成 glTF Y-up，Cesium 加载 3D Tiles 内容时再按标准转回 Z-up，保证接头任意分支方向不被旋错。
        matrix: Z_UP_TO_GLTF_Y_UP_MATRIX,
        mesh: 0,
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: primitiveAttributes,
            indices: indexAccessorIndex,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      materialDefinition,
    ],
    buffers: [{ byteLength: binaryBuffer.length }],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positionBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBuffer.length, target: 34962 },
      ...(texcoordBuffer
        ? [{ buffer: 0, byteOffset: texcoordOffset, byteLength: texcoordBuffer.length, target: 34962 }]
        : []),
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBuffer.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
        min: mesh.min,
        max: mesh.max,
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
      },
      ...(hasTexcoords
        ? [
            {
              bufferView: 2,
              byteOffset: 0,
              componentType: 5126,
              count: vertexCount,
              type: "VEC2",
            },
          ]
        : []),
      {
        bufferView: hasTexcoords ? 3 : 2,
        byteOffset: 0,
        componentType: indexData.componentType,
        count: mesh.indices.length,
        type: "SCALAR",
      },
    ],
  };

  if (textureEntries.length > 0) {
    gltf.samplers = [
      {
        magFilter: 9729,
        minFilter: 9987,
        wrapS: 10497,
        wrapT: 10497,
      },
    ];
    gltf.images = textureImages;
    gltf.textures = textureEntries;
  }

  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(gltf)), 4, 0x20);
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binaryBuffer.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.write("JSON", 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binaryBuffer.length, 0);
  binChunkHeader.write("BIN\0", 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer, binChunkHeader, binaryBuffer]);
}

function makeTemplateRootMatrix(length, outerRadius) {
  // 标准模板约定：局部 X 为长度，局部 Y/Z 为半径方向，原点在管线中心。
  return [
    length, 0, 0, 0,
    0, outerRadius, 0, 0,
    0, 0, outerRadius, 0,
    0, 0, 0, 1,
  ];
}

async function createTemplatePipeGlb(config, placement) {
  const modelId = normalizeModelId(config.model);
  const modelConfig = getPipeModelConfig(config.model);

  if (modelConfig.mode !== "template" || !modelConfig.templatePath) {
    throw new Error(`未注册的管线模型：${modelId}`);
  }

  const { gltf, binary } = await readGlbFile(modelConfig.templatePath);
  const templateNodes = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [0];
  const originalNodes = gltf.nodes ?? [];

  // 这里只在最外层缩放标准模板，不再直接拉伸原始 Sketchfab 场景层级。
  gltf.nodes = [
    {
      name: `pipeline-generated-${modelId}-root`,
      matrix: makeTemplateRootMatrix(placement.length, config.shape.outerRadius),
      children: templateNodes.map((nodeIndex) => nodeIndex + 1),
    },
    ...originalNodes,
  ];

  for (const scene of gltf.scenes ?? []) {
    scene.nodes = [0];
  }

  for (const node of gltf.nodes.slice(1)) {
    if (Array.isArray(node.children)) {
      node.children = node.children.map((child) => child + 1);
    }
  }

  return createGlbFromChunks(gltf, binary);
}

function createPipeBounds(config, placement) {
  const halfLength = placement.length / 2;
  const radius = Math.max(config.shape.outerRadius, 0.01);

  return {
    min: [-halfLength, -radius, -radius],
    max: [halfLength, radius, radius],
    length: placement.length,
  };
}

function padJsonSection(json, absoluteOffset) {
  const raw = Buffer.from(json);
  const paddingLength = (8 - ((absoluteOffset + raw.length) % 8)) % 8;
  return Buffer.concat([raw, Buffer.from(" ".repeat(paddingLength))]);
}

function createB3dm(glb) {
  const featureTableJson = padJsonSection('{"BATCH_LENGTH":0}', 28);
  const byteLength = 28 + featureTableJson.length + glb.length;
  const header = Buffer.alloc(28);
  header.write("b3dm", 0);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(byteLength, 8);
  header.writeUInt32LE(featureTableJson.length, 12);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(0, 20);
  header.writeUInt32LE(0, 24);

  return Buffer.concat([header, featureTableJson, glb]);
}

function createTileset(config, placement, mesh) {
  const min = mesh.min;
  const max = mesh.max;
  const isJoint = config.kind === "joint";
  const boundingPadding = isJoint
    ? Math.max(config.shape.outerRadius * 8, 2.4)
    : 0;
  const center = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const halfSize = [
    Math.max((max[0] - min[0]) / 2 + boundingPadding, config.shape.outerRadius),
    Math.max((max[1] - min[1]) / 2 + boundingPadding, config.shape.outerRadius),
    Math.max((max[2] - min[2]) / 2 + boundingPadding, config.shape.outerRadius),
  ];
  const geometricError = Math.max(...halfSize) * 2;
  const rootGeometricError = isJoint
    ? Math.max(config.shape.outerRadius * 32, 8)
    : 0;

  return {
    asset: {
      version: "1.0",
      tilesetVersion: `${config.id}-1`,
      // 不声明 gltfUpAxis，按 3D Tiles 1.0 默认 glTF Y-up 处理；程序化 mesh 已在 glTF root node 中完成 Z-up -> Y-up。
    },
    geometricError: Math.max(geometricError, rootGeometricError, config.shape.outerRadius * 8),
    root: {
      transform: placement.transform,
      boundingVolume: {
        box: [
          center[0], center[1], center[2],
          halfSize[0], 0, 0,
          0, halfSize[1], 0,
          0, 0, halfSize[2],
        ],
      },
      // 接头模型尺寸小，包围盒过紧或几何误差过小会在远距离被 Cesium 过早裁剪。
      geometricError: rootGeometricError,
      refine: "ADD",
      content: {
        uri: `${config.id}.b3dm`,
      },
    },
  };
}

export async function writePipeTileset(config, outputDir) {
  const isJoint = config.kind === "joint";
  if (config.kind === "bend") {
    // 独立弯管 tileset 写入暂时停用；连接点内的小弯段应由 joint 分支建模处理。
    throw new Error("独立弯管 3D Tiles 生成功能已停用");
  }

  const placement = isJoint
    ? buildJointPlacement(config.center)
    : buildPipePlacement(config.start, config.end);
  const mesh = isJoint
    ? buildJointRoundPipeMesh({
        branches: config.branches.map((branch) => ({
          ...branch,
          direction: directionToLocal(
            [branch.direction.x, branch.direction.y, branch.direction.z],
            placement.axes,
          ),
          socketCenter: branch.socketCenter
            ? positionToLocal(branch.socketCenter, placement)
            : undefined,
        })),
        jointKind: config.jointKind,
        branchLength: config.branchLength,
        socketLength: config.socketLength,
        frameNormal: [0, 0, 1],
        outerRadius: config.shape.outerRadius,
        wallThickness: config.shape.wallThickness,
        radialSegments: config.shape.radialSegments,
      })
    : buildStraightRoundPipeMesh({
        length: placement.length,
        outerRadius: config.shape.outerRadius,
        wallThickness: config.shape.wallThickness,
        radialSegments: config.shape.radialSegments,
      });
  const useTemplateModel = shouldUseTemplatePipeModel(config);
  const modelMaterial = await getPipeModelMaterialProfile(config.model);
  const material = mergeMaterialWithModelStyle(config.material, modelMaterial);
  const glb = useTemplateModel
    ? await createTemplatePipeGlb(config, placement)
    : createGlb(mesh, material);
  const bounds = useTemplateModel ? createPipeBounds(config, placement) : mesh;
  const b3dm = createB3dm(glb);
  const tileset = createTileset(config, placement, bounds);

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, `${config.id}.glb`), glb);
  await writeFile(join(outputDir, `${config.id}.b3dm`), b3dm);
  await writeFile(join(outputDir, "tileset.json"), JSON.stringify(tileset, null, 2));

  return {
    length: bounds.length ?? placement.length,
    outputDir,
  };
}
