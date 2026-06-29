import type { PipeBusinessType, PipeLayer, PipeShape } from "../types/pipeline";

export const PIPELINE_PICK_RANGE_LIMIT_METERS = 500;
export const PIPELINE_ENDPOINT_SNAP_PIXELS = 10;
export const PIPELINE_MIN_LINE_LENGTH_METERS = 0.01;
export const PIPELINE_AXIS_BASE_LENGTH_METERS = 30;

export const DEFAULT_PIPE_LAYER_ID = "default";
export const DEFAULT_PIPE_BUSINESS_TYPE_ID = "water";

export const DEFAULT_PIPE_LAYERS: PipeLayer[] = [
  {
    id: DEFAULT_PIPE_LAYER_ID,
    name: "默认图层",
    color: "#00d4ff",
    visible: true,
  },
];

export const DEFAULT_PIPE_BUSINESS_TYPES: PipeBusinessType[] = [
  {
    id: "water",
    name: "给水",
    color: "#2f80ed",
  },
  {
    id: "drainage",
    name: "排水",
    color: "#7b61ff",
  },
  {
    id: "gas",
    name: "燃气",
    color: "#f2994a",
  },
];

export const PIPE_BUSINESS_MODEL_OPTIONS: Record<string, string[]> = {
  water: ["ductile-iron-epoxy", "pipe-pp-pvc", "galvanized-steel", "coated-matte"],
  drainage: ["frp-sand-pipe", "pipe-pp-pvc", "coated-matte"],
  gas: ["hdpe-black-gas", "carbon-steel-new", "straight-9-metal", "carbon-steel-heavy-rust"],
};

export const DEFAULT_PIPE_MODEL_BY_BUSINESS: Record<string, string> = {
  water: "ductile-iron-epoxy",
  drainage: "frp-sand-pipe",
  gas: "hdpe-black-gas",
};

export function normalizePipeBusinessTypeId(value?: string | null) {
  if (value === "default" || value === "sewage" || !value) {
    return DEFAULT_PIPE_BUSINESS_TYPE_ID;
  }

  return DEFAULT_PIPE_BUSINESS_TYPES.some((businessType) => businessType.id === value)
    ? value
    : DEFAULT_PIPE_BUSINESS_TYPE_ID;
}

export function getAllowedPipeModelIdsForBusiness(businessTypeId?: string | null) {
  const normalizedBusinessTypeId = normalizePipeBusinessTypeId(businessTypeId);

  return PIPE_BUSINESS_MODEL_OPTIONS[normalizedBusinessTypeId] ?? PIPE_BUSINESS_MODEL_OPTIONS.water;
}

export function getDefaultPipeModelIdForBusiness(businessTypeId?: string | null) {
  const normalizedBusinessTypeId = normalizePipeBusinessTypeId(businessTypeId);

  return DEFAULT_PIPE_MODEL_BY_BUSINESS[normalizedBusinessTypeId] ?? DEFAULT_PIPE_MODEL_BY_BUSINESS.water;
}

export function normalizePipeModelForBusiness(businessTypeId?: string | null, modelId?: string | null) {
  const allowedModelIds = getAllowedPipeModelIdsForBusiness(businessTypeId);

  return modelId && allowedModelIds.includes(modelId)
    ? modelId
    : getDefaultPipeModelIdForBusiness(businessTypeId);
}

export const DEFAULT_CIRCLE_PIPE_SHAPE: PipeShape = {
  type: "circle",
  radius: 0.3,
  thickness: 0.02,
  flangeLength: 0,
  flangeThickness: 0,
};
