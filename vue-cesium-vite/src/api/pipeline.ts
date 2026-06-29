import type {
  PipeEndpoint,
  PipeJointKind,
  PipeJointModelUpdate,
  PipeLineDraft,
  PipeLineModelUpdate,
  PipelineApiResponse,
  PipelineBootstrapPayload,
  PipelineImportPreview,
  PipelineJob,
  PipelineMutationPayload,
  PipelineTilesGenerateResult,
} from "../types/pipeline";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) as PipelineApiResponse<T> : null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `请求失败：${response.status}`);
  }

  return payload.data;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  return readJsonResponse<T>(response);
}

function lineDraftShapePayload(lineDraft: PipeLineDraft) {
  if (lineDraft.shape.type === "circle") {
    return lineDraft.shape;
  }

  return {
    type: "circle",
    radius: Math.max(lineDraft.shape.width, lineDraft.shape.height) / 2,
    thickness: lineDraft.shape.thickness,
    flangeLength: lineDraft.shape.flangeLength,
    flangeThickness: lineDraft.shape.flangeThickness,
  };
}

export function fetchPipelineBootstrap() {
  return requestJson<PipelineBootstrapPayload>("/api/pipeline/projects/default/bootstrap");
}

export function createPipelinePoint(payload: {
  lon: number;
  lat: number;
  height: number;
  groundHeight: number | null;
  relativeHeight: number;
  maishen?: number;
  layerId?: string;
  businessTypeId?: string;
}) {
  return requestJson<PipelineMutationPayload>("/api/pipeline/points", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deletePipelinePoint(id: string) {
  return requestJson<PipelineMutationPayload>(`/api/pipeline/points/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function createPipelineLine(payload: {
  start: PipeEndpoint;
  end: PipeEndpoint;
  businessTypeId?: string;
  modelId?: string;
  shape: PipeLineDraft["shape"];
  layerId?: string;
}) {
  return requestJson<PipelineMutationPayload>("/api/pipeline/lines", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      shape: lineDraftShapePayload({ start: payload.start, end: payload.end, businessTypeId: payload.businessTypeId, modelId: payload.modelId, shape: payload.shape }),
    }),
  });
}

export function updatePipelineLineModel(id: string, update: PipeLineModelUpdate) {
  return requestJson<PipelineMutationPayload>(`/api/pipeline/lines/${encodeURIComponent(id)}/model`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function deletePipelineLine(id: string) {
  return requestJson<PipelineMutationPayload>(`/api/pipeline/lines/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updatePipelineJointKind(id: string, jointKind: PipeJointKind) {
  return requestJson<PipelineMutationPayload>(`/api/pipeline/joints/${encodeURIComponent(id)}/kind`, {
    method: "PATCH",
    body: JSON.stringify({ jointKind }),
  });
}

export function updatePipelineJointModel(id: string, update: PipeJointModelUpdate) {
  return requestJson<PipelineMutationPayload>(`/api/pipeline/joints/${encodeURIComponent(id)}/model`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function generatePipelineTiles(payload: {
  targetType: "line" | "joint";
  targetId: string;
  outputSubdir?: string;
}) {
  return requestJson<PipelineTilesGenerateResult>("/api/pipeline/tiles/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generatePipelineProjectTiles() {
  return requestJson<PipelineJob>("/api/pipeline/tiles/generate-project", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function previewExcelPipelineImport(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/pipeline/imports/excel/preview", {
    method: "POST",
    body: formData,
  });

  return readJsonResponse<PipelineImportPreview>(response);
}

export async function previewCsvPipelineImport(points: File, lines: File) {
  const formData = new FormData();
  formData.append("points", points);
  formData.append("lines", lines);
  const response = await fetch("/api/pipeline/imports/csv/preview", {
    method: "POST",
    body: formData,
  });

  return readJsonResponse<PipelineImportPreview>(response);
}

export function commitPipelineImport(jobId: number, payload: { mode: "append" | "replace"; autoGenerate: boolean }) {
  return requestJson<PipelineMutationPayload>(`/api/pipeline/imports/${jobId}/commit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchPipelineJob(id: number) {
  return requestJson<PipelineJob>(`/api/pipeline/jobs/${id}`);
}
