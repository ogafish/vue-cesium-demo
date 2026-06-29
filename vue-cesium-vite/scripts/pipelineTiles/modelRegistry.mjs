import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

export const PROCEDURAL_ROUND_MODEL_ID = "procedural-round";

export const PIPE_MODEL_REGISTRY = {
  [PROCEDURAL_ROUND_MODEL_ID]: {
    id: PROCEDURAL_ROUND_MODEL_ID,
    mode: "procedural",
  },
  "pipe-pp-pvc": {
    id: "pipe-pp-pvc",
    mode: "procedural-style",
    materialProfilePath: join(CURRENT_DIR, "assets", "pipe_pp_pvc_style.profile.json"),
    materialStyle: {
      name: "PP/PVC fine surface",
      metallicFactor: 0.02,
      roughnessFactor: 0.72,
      texturePreset: "pvc-fine",
      textureResolution: 160,
      textureFrequency: 26,
      microNoiseStrength: 0.08,
      circumferentialBandStrength: 0.03,
      doubleSided: true,
    },
  },
  "straight-9-metal": {
    id: "straight-9-metal",
    mode: "procedural-style",
    materialProfilePath: join(CURRENT_DIR, "assets", "straight_9_metal_style.profile.json"),
    materialStyle: {
      name: "industrial carbon steel light rust",
      metallicFactor: 0.9,
      roughnessFactor: 0.36,
      texturePreset: "carbon-steel-light-rust",
      textureResolution: 256,
      rustLevel: 0.3,
      oilStainStrength: 0.14,
      weldStrength: 0.82,
      rollingGrainFrequency: 34,
      normalScale: 0.85,
      occlusionStrength: 0.75,
      emissiveFactor: [0, 0, 0],
      doubleSided: true,
    },
  },
  "carbon-steel-new": {
    id: "carbon-steel-new",
    mode: "procedural-style",
    materialStyle: {
      name: "industrial carbon steel new",
      metallicFactor: 0.93,
      roughnessFactor: 0.26,
      texturePreset: "carbon-steel-new",
      textureResolution: 256,
      rustLevel: 0.06,
      oilStainStrength: 0.06,
      weldStrength: 0.52,
      rollingGrainFrequency: 38,
      normalScale: 0.45,
      occlusionStrength: 0.35,
      emissiveFactor: [0, 0, 0],
      doubleSided: true,
    },
  },
  "carbon-steel-heavy-rust": {
    id: "carbon-steel-heavy-rust",
    mode: "procedural-style",
    materialStyle: {
      name: "industrial carbon steel heavy rust",
      metallicFactor: 0.86,
      roughnessFactor: 0.58,
      texturePreset: "carbon-steel-heavy-rust",
      textureResolution: 256,
      rustLevel: 0.78,
      oilStainStrength: 0.24,
      weldStrength: 0.75,
      rollingGrainFrequency: 30,
      normalScale: 1.15,
      occlusionStrength: 0.95,
      emissiveFactor: [0, 0, 0],
      doubleSided: true,
    },
  },
  "coated-matte": {
    id: "coated-matte",
    mode: "procedural-style",
    materialStyle: {
      name: "matte coated surface",
      metallicFactor: 0.04,
      roughnessFactor: 0.82,
      texturePreset: "matte-coated",
      textureResolution: 160,
      textureFrequency: 22,
      microNoiseStrength: 0.12,
      circumferentialBandStrength: 0.04,
      normalScale: 0.42,
      occlusionStrength: 0.38,
      doubleSided: true,
    },
  },
  "hdpe-black-gas": {
    id: "hdpe-black-gas",
    mode: "procedural-style",
    materialStyle: {
      name: "black HDPE gas pipe",
      metallicFactor: 0.0,
      roughnessFactor: 0.66,
      texturePreset: "hdpe-black-gas",
      textureResolution: 160,
      textureFrequency: 18,
      microNoiseStrength: 0.1,
      axialStripeStrength: 0.42,
      stripeFrequency: 4,
      normalScale: 0.28,
      occlusionStrength: 0.32,
      doubleSided: true,
    },
  },
  "ductile-iron-epoxy": {
    id: "ductile-iron-epoxy",
    mode: "procedural-style",
    materialStyle: {
      name: "epoxy coated ductile iron",
      metallicFactor: 0.28,
      roughnessFactor: 0.54,
      texturePreset: "ductile-iron-epoxy",
      textureResolution: 192,
      textureFrequency: 16,
      microNoiseStrength: 0.16,
      pittingStrength: 0.2,
      coatingWearStrength: 0.14,
      normalScale: 0.55,
      occlusionStrength: 0.48,
      doubleSided: true,
    },
  },
  "frp-sand-pipe": {
    id: "frp-sand-pipe",
    mode: "procedural-style",
    materialStyle: {
      name: "FRP sand pipe",
      metallicFactor: 0.0,
      roughnessFactor: 0.76,
      texturePreset: "frp-sand-pipe",
      textureResolution: 192,
      textureFrequency: 30,
      fiberStrength: 0.36,
      sandGrainStrength: 0.22,
      microNoiseStrength: 0.12,
      normalScale: 0.5,
      occlusionStrength: 0.42,
      doubleSided: true,
    },
  },
  "galvanized-steel": {
    id: "galvanized-steel",
    mode: "procedural-style",
    materialStyle: {
      name: "galvanized steel pipe",
      metallicFactor: 0.82,
      roughnessFactor: 0.42,
      texturePreset: "galvanized-steel",
      textureResolution: 256,
      textureFrequency: 20,
      zincCrystalStrength: 0.28,
      seamStrength: 0.36,
      microNoiseStrength: 0.1,
      normalScale: 0.5,
      occlusionStrength: 0.45,
      doubleSided: true,
    },
  },
};

const materialProfileCache = new Map();

export function normalizeModelId(model) {
  // 兼容旧配置的 source 字段，统一收敛成 registry 中的模型 ID。
  if (model?.id) {
    return model.id;
  }

  if (model?.source === "pipe_pp_pvc_glb") {
    return "pipe-pp-pvc";
  }

  return PROCEDURAL_ROUND_MODEL_ID;
}

export function getPipeModelConfig(model) {
  return PIPE_MODEL_REGISTRY[normalizeModelId(model)] ?? PIPE_MODEL_REGISTRY[PROCEDURAL_ROUND_MODEL_ID];
}

export function getSupportedPipeModelIds() {
  // 只有 registry 中明确注册的模型才能进入配置校验和前端可选链路。
  return new Set(Object.keys(PIPE_MODEL_REGISTRY));
}

export function shouldUseTemplatePipeModel(config) {
  const modelConfig = getPipeModelConfig(config.model);

  // 模板 GLB 只允许用于直管；连接管继续由 socket/centerline 的业务几何生成。
  return config.kind !== "joint" && modelConfig.mode === "template" && Boolean(modelConfig.templatePath);
}

export async function getPipeModelMaterialProfile(model) {
  const modelConfig = getPipeModelConfig(model);
  const registryStyle = modelConfig.materialStyle ?? null;

  if (!modelConfig.materialProfilePath) {
    return registryStyle;
  }

  if (!materialProfileCache.has(modelConfig.materialProfilePath)) {
    materialProfileCache.set(
      modelConfig.materialProfilePath,
      readFile(modelConfig.materialProfilePath, "utf8")
        .then((content) => JSON.parse(content))
        .catch(() => null),
    );
  }

  const profile = await materialProfileCache.get(modelConfig.materialProfilePath);

  return {
    ...(profile?.material ?? {}),
    ...(registryStyle ?? {}),
  };
}

export function mergeMaterialWithModelStyle(configMaterial, modelMaterial) {
  if (!modelMaterial) {
    return configMaterial ?? {};
  }

  return {
    ...(configMaterial ?? {}),
    // 模型风格只影响视觉材质，不参与 socket、半径、中心线等业务几何计算。
    // 业务类型颜色必须优先，外部 GLB 或模型风格不能覆盖 color/baseColorFactor。
    name: modelMaterial.name ?? configMaterial?.name,
    color: configMaterial?.color,
    baseColorFactor: configMaterial?.baseColorFactor,
    metallicFactor: modelMaterial.metallicFactor ?? configMaterial?.metallicFactor,
    roughnessFactor: modelMaterial.roughnessFactor ?? configMaterial?.roughnessFactor,
    doubleSided: modelMaterial.doubleSided ?? configMaterial?.doubleSided,
    texturePreset: modelMaterial.texturePreset ?? configMaterial?.texturePreset,
    textureResolution: modelMaterial.textureResolution ?? configMaterial?.textureResolution,
    textureFrequency: modelMaterial.textureFrequency ?? configMaterial?.textureFrequency,
    microNoiseStrength: modelMaterial.microNoiseStrength ?? configMaterial?.microNoiseStrength,
    circumferentialBandStrength:
      modelMaterial.circumferentialBandStrength ?? configMaterial?.circumferentialBandStrength,
    axialStripeStrength: modelMaterial.axialStripeStrength ?? configMaterial?.axialStripeStrength,
    stripeFrequency: modelMaterial.stripeFrequency ?? configMaterial?.stripeFrequency,
    rustLevel: modelMaterial.rustLevel ?? configMaterial?.rustLevel,
    oilStainStrength: modelMaterial.oilStainStrength ?? configMaterial?.oilStainStrength,
    weldStrength: modelMaterial.weldStrength ?? configMaterial?.weldStrength,
    rollingGrainFrequency: modelMaterial.rollingGrainFrequency ?? configMaterial?.rollingGrainFrequency,
    pittingStrength: modelMaterial.pittingStrength ?? configMaterial?.pittingStrength,
    coatingWearStrength: modelMaterial.coatingWearStrength ?? configMaterial?.coatingWearStrength,
    fiberStrength: modelMaterial.fiberStrength ?? configMaterial?.fiberStrength,
    sandGrainStrength: modelMaterial.sandGrainStrength ?? configMaterial?.sandGrainStrength,
    zincCrystalStrength: modelMaterial.zincCrystalStrength ?? configMaterial?.zincCrystalStrength,
    seamStrength: modelMaterial.seamStrength ?? configMaterial?.seamStrength,
    normalScale: modelMaterial.normalScale ?? configMaterial?.normalScale,
    occlusionStrength: modelMaterial.occlusionStrength ?? configMaterial?.occlusionStrength,
    emissiveFactor: modelMaterial.emissiveFactor ?? configMaterial?.emissiveFactor,
  };
}
