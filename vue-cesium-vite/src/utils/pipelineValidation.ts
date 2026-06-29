import {
  PIPELINE_MIN_LINE_LENGTH_METERS,
  PIPELINE_PICK_RANGE_LIMIT_METERS,
  normalizePipeBusinessTypeId,
} from "../constants/pipelineDefaults";
import type { PipeEndpoint, PipeLine, ValidationResult } from "../types/pipeline";
import { buildConnectionKey, distanceBetweenEndpoints, resolveEndpointKey } from "./pipelineGeometry";

type EndpointBusinessResolution =
  | {
      kind: "none";
    }
  | {
      kind: "single";
      businessTypeId: string;
    }
  | {
      kind: "mixed";
      businessTypeIds: string[];
    };

function getLineBusinessTypeId(line: PipeLine) {
  return normalizePipeBusinessTypeId(line.businessTypeId);
}

function getEndpointBusinessResolution(
  endpoint: PipeEndpoint,
  lines: PipeLine[],
): EndpointBusinessResolution {
  const endpointKey = resolveEndpointKey(endpoint, lines);
  const businessTypeIds = new Set<string>();

  for (const line of lines) {
    if (
      resolveEndpointKey(line.start, lines) === endpointKey ||
      resolveEndpointKey(line.end, lines) === endpointKey
    ) {
      businessTypeIds.add(getLineBusinessTypeId(line));
    }
  }

  if (businessTypeIds.size === 0) {
    return { kind: "none" };
  }

  if (businessTypeIds.size === 1) {
    return {
      kind: "single",
      businessTypeId: Array.from(businessTypeIds)[0],
    };
  }

  return {
    kind: "mixed",
    businessTypeIds: Array.from(businessTypeIds),
  };
}

export function validatePipePointPick(relativeHeight: number): ValidationResult {
  if (Math.abs(relativeHeight) > PIPELINE_PICK_RANGE_LIMIT_METERS) {
    return {
      ok: false,
      message: "请选择地球表面附近 500m 范围内的位置",
    };
  }

  return { ok: true };
}

// 管线确认前统一校验草稿状态，所有失败都只提示，不写入正式管线列表。
export function validatePipeLineDraft(
  start: PipeEndpoint | null,
  end: PipeEndpoint | null,
  lines: PipeLine[],
  businessTypeId?: string | null,
  ignoreLineId?: string,
): ValidationResult {
  if (!start) {
    return {
      ok: false,
      message: "请选择管线起点",
    };
  }

  if (!end) {
    return {
      ok: false,
      message: "请选择管线终点",
    };
  }

  if (start.endpointKey === end.endpointKey) {
    return {
      ok: false,
      message: "起点和终点不能是同一个端点",
    };
  }

  if (distanceBetweenEndpoints(start, end) < PIPELINE_MIN_LINE_LENGTH_METERS) {
    return {
      ok: false,
      message: "起点和终点距离过近，无法生成管线",
    };
  }

  const normalizedBusinessTypeId = normalizePipeBusinessTypeId(businessTypeId);
  const startBusinessResolution = getEndpointBusinessResolution(start, lines);
  const endBusinessResolution = getEndpointBusinessResolution(end, lines);

  if (startBusinessResolution.kind === "mixed" || endBusinessResolution.kind === "mixed") {
    return {
      ok: false,
      message: "端点已关联多个业务类型的管线，无法继续连接",
    };
  }

  const startBusinessTypeId =
    startBusinessResolution.kind === "single" ? startBusinessResolution.businessTypeId : null;
  const endBusinessTypeId =
    endBusinessResolution.kind === "single" ? endBusinessResolution.businessTypeId : null;

  if (startBusinessTypeId && endBusinessTypeId && startBusinessTypeId !== endBusinessTypeId) {
    return {
      ok: false,
      message: "不同业务类型的管线不能连接",
    };
  }

  const connectedBusinessTypeId = startBusinessTypeId ?? endBusinessTypeId;
  if (connectedBusinessTypeId && connectedBusinessTypeId !== normalizedBusinessTypeId) {
    return {
      ok: false,
      message: "草稿业务类型与已连接管线不一致，无法生成管线",
    };
  }

  // 重复判断必须使用归一化 connectionKey，不能直接比较用户点击到的表面 endpointKey。
  const connectionKey = buildConnectionKey(start, end, lines);
  const duplicateLine = lines.find(
    (line) => line.id !== ignoreLineId && line.connectionKey === connectionKey,
  );

  if (duplicateLine) {
    return {
      ok: false,
      message: "管线无法在此生成，两个端点之间已存在管线",
    };
  }

  return { ok: true };
}
