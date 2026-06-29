import type { Cartesian3 } from "cesium";

export type PipelineToolMode =
  | "none"
  | "add-point"
  | "add-line"
  | "point-manager"
  | "line-manager"
  | "material"
  | "import"
  | "info";

export type PipeShape =
  | {
      type: "circle";
      radius: number;
      thickness: number;
      flangeLength: number;
      flangeThickness: number;
    }
  | {
      type: "rectangle";
      width: number;
      height: number;
      thickness: number;
      flangeLength: number;
      flangeThickness: number;
    };

export type PipePoint = {
  id: string;
  lon: number;
  lat: number;
  height: number;
  groundHeight: number | null;
  relativeHeight: number;
  maishen: number;
  layerId: string;
  businessTypeId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PipePointDraft = {
  cartesian: Cartesian3;
  lon: number;
  lat: number;
  height: number;
  groundHeight: number | null;
  relativeHeight: number;
};

export type PipeEndpoint = {
  endpointKey: string;
  sourceType: "point" | "line-endpoint" | "free";
  sourceId: string;
  lon: number;
  lat: number;
  height: number;
  pointId?: string;
  lineId?: string;
  endpointRole?: "start" | "end";
};

export type PipeLineDraft = {
  start: PipeEndpoint | null;
  end: PipeEndpoint | null;
  businessTypeId?: string;
  modelId?: string;
  shape: PipeShape;
};

export type PipeCoordinate = {
  lon: number;
  lat: number;
  height: number;
};

export type PipeLine = {
  id: string;
  kind: "straight";
  start: PipeEndpoint;
  end: PipeEndpoint;
  startPointId?: string;
  endPointId?: string;
  layerId: string;
  businessTypeId?: string;
  modelId?: string;
  shape: PipeShape;
  length: number;
  connectionKey: string;
  detailModelStatus: "none" | "generating" | "loaded" | "failed" | "dirty";
  detailTilesetUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type PipeJointKind =
  | "terminal"
  | "straight"
  | "uBend"
  | "threeWay"
  | "fourWay"
  | "multi";

export type PipeConnectionDirection = {
  x: number;
  y: number;
  z: number;
};

export type PipeConnectionBranch = {
  lineId: string;
  endpointRole: "start" | "end";
  endpointKey: string;
  lineKind: PipeLine["kind"];
  outerRadius: number;
  wallThickness: number;
  businessTypeId?: string;
  direction: PipeConnectionDirection;
};

export type PipeConnectionNode = {
  id: string;
  nodeKey: string;
  pointId?: string;
  position: PipeCoordinate;
  degree: number;
  connectionLineIds: string[];
  jointKind: PipeJointKind;
  recommendedJointKind: PipeJointKind;
  jointLabel: string;
  branches: PipeConnectionBranch[];
};

export type PipeJointModelStatus = "none" | "generating" | "loaded" | "failed" | "dirty";

export type PipeJoint = {
  id: string;
  nodeId: string;
  nodeKey: string;
  pointId?: string;
  jointKind: PipeJointKind;
  recommendedJointKind: PipeJointKind;
  jointLabel: string;
  manualOverride: boolean;
  position: PipeCoordinate;
  degree: number;
  connectionLineIds: string[];
  branches: PipeConnectionBranch[];
  branchLineIds: string[];
  businessTypeId?: string;
  modelId?: string;
  geometrySignature: string;
  socketSignature: string;
  detailModelStatus: PipeJointModelStatus;
  detailTilesetUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type PipeLineModelUpdate = {
  radius: number;
  thickness: number;
  businessTypeId?: string;
  modelId?: string;
};

export type PipeJointModelUpdate = {
  businessTypeId?: string;
  modelId?: string;
};

export type PipeLayer = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
};

export type PipeBusinessType = {
  id: string;
  name: string;
  color: string;
};

export type PipeModelOption = {
  id: string;
  name: string;
  description: string;
};

export type SelectedPipelineObject =
  | {
      type: "point";
      id: string;
    }
  | {
      type: "line";
      id: string;
    }
  | {
      type: "joint";
      id: string;
    };

export type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

export type PipelineProject = {
  id: string;
  name: string;
  description?: string;
};

export type PipelineBootstrapPayload = {
  project: PipelineProject;
  layers: PipeLayer[];
  businessTypes: PipeBusinessType[];
  modelOptions: PipeModelOption[];
  businessModelOptions: Record<string, string[]>;
  defaultModelByBusiness: Record<string, string>;
  points: PipePoint[];
  lines: PipeLine[];
  joints: PipeJoint[];
  tilesetUrls: string[];
};

export type PipelineMutationPayload = {
  changedType: "point" | "line" | "joint" | "import" | string;
  changedId: string;
  bootstrap: PipelineBootstrapPayload;
};

export type PipelineApiResponse<T> = {
  ok: boolean;
  message: string;
  data: T;
};

export type PipelineImportError = {
  sheetName: string;
  rowNumber: number;
  fieldName: string | null;
  message: string;
};

export type PipelineImportPreview = {
  jobId: number;
  status: string;
  totalPoints: number;
  totalLines: number;
  errorCount: number;
  pointPreview: Array<Record<string, unknown>>;
  linePreview: Array<Record<string, unknown>>;
  errors: PipelineImportError[];
};

export type PipelineJobItem = {
  targetType: string;
  targetId: string;
  status: string;
  tilesetUrl?: string | null;
  errorMessage?: string | null;
};

export type PipelineJob = {
  id: number;
  type: "generation" | "import" | string;
  status: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  message?: string | null;
  items: PipelineJobItem[];
};

export type PipelineTilesGenerateResult = {
  targetType: "line" | "joint";
  targetId: string;
  url: string;
  length: number;
};
