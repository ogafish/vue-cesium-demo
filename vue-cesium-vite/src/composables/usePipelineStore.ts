import { markRaw, reactive } from "vue";
import { DEFAULT_PIPE_MODEL_ID } from "../constants/pipelineModelOptions";
import {
  getEditableJointKindsByDegree,
  getPipeJointKindLabel,
} from "../constants/pipelineJointOptions";
import {
  DEFAULT_CIRCLE_PIPE_SHAPE,
  DEFAULT_PIPE_BUSINESS_TYPE_ID,
  DEFAULT_PIPE_BUSINESS_TYPES,
  DEFAULT_PIPE_LAYER_ID,
  DEFAULT_PIPE_LAYERS,
  normalizePipeBusinessTypeId,
  normalizePipeModelForBusiness,
} from "../constants/pipelineDefaults";
import type {
  PipeEndpoint,
  PipeConnectionNode,
  PipeJoint,
  PipeJointKind,
  PipeJointModelUpdate,
  PipeJointModelStatus,
  PipeLine,
  PipeLineDraft,
  PipeLineModelUpdate,
  PipePoint,
  PipePointDraft,
  PipelineBootstrapPayload,
  PipelineMutationPayload,
  PipelineToolMode,
  SelectedPipelineObject,
} from "../types/pipeline";
import {
  buildConnectionKey,
  buildPointEndpointKey,
  createLineId,
  createPointId,
  distanceBetweenEndpoints,
  resolveEndpointKey,
} from "../utils/pipelineGeometry";
import {
  buildPipeConnectionNodes,
  buildPipeJoints,
  makeJointGeometrySignature,
} from "../utils/pipelineTopology";
import { validatePipeLineDraft } from "../utils/pipelineValidation";

type PipelineFlyToRequest = {
  type: "point" | "line";
  id: string;
  nonce: number;
};

function calculateLineLength(line: Pick<PipeLine, "start" | "end">) {
  return distanceBetweenEndpoints(line.start, line.end);
}

function getEndpointBusinessTypeIds(endpoint: PipeEndpoint, lines: PipeLine[], ignoreLineId?: string) {
  const endpointKey = resolveEndpointKey(endpoint, lines);
  const businessTypeIds = new Set<string>();

  for (const line of lines) {
    if (line.id === ignoreLineId) {
      continue;
    }

    const startKey = resolveEndpointKey(line.start, lines);
    const endKey = resolveEndpointKey(line.end, lines);

    if (startKey === endpointKey || endKey === endpointKey) {
      businessTypeIds.add(normalizePipeBusinessTypeId(line.businessTypeId));
    }
  }

  return Array.from(businessTypeIds);
}

function canUpdateLineBusinessType(line: PipeLine, lines: PipeLine[], nextBusinessTypeId: string) {
  const relatedBusinessTypeIds = new Set<string>([
    ...getEndpointBusinessTypeIds(line.start, lines, line.id),
    ...getEndpointBusinessTypeIds(line.end, lines, line.id),
  ]);

  if (relatedBusinessTypeIds.size === 0) {
    return true;
  }

  return relatedBusinessTypeIds.size === 1 && relatedBusinessTypeIds.has(nextBusinessTypeId);
}

function createDefaultLineDraft(): PipeLineDraft {
  return {
    start: null,
    end: null,
    businessTypeId: DEFAULT_PIPE_BUSINESS_TYPE_ID,
    modelId: normalizePipeModelForBusiness(DEFAULT_PIPE_BUSINESS_TYPE_ID, DEFAULT_PIPE_MODEL_ID),
    shape: { ...DEFAULT_CIRCLE_PIPE_SHAPE },
  };
}

function getNextIndexFromIds(ids: string[], prefix: string) {
  const maxIndex = ids.reduce((max, id) => {
    if (!id.startsWith(prefix)) {
      return max;
    }

    const value = Number(id.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return maxIndex + 1;
}

export function createPipelineStore() {
  // store 是管网编辑的数据源；Cesium entity 和 3D Tiles 都应视为它的渲染结果。
  const state = reactive({
    activeTool: "none" as PipelineToolMode,
    points: [] as PipePoint[],
    lines: [] as PipeLine[],
    layers: [...DEFAULT_PIPE_LAYERS],
    businessTypes: [...DEFAULT_PIPE_BUSINESS_TYPES],
    pointDraft: null as PipePointDraft | null,
    lineDraft: createDefaultLineDraft(),
    selectedObject: null as SelectedPipelineObject | null,
    message: "",
    nextPointIndex: 1,
    nextLineIndex: 1,
    flyToRequest: null as PipelineFlyToRequest | null,
    showPipePoints: true,
    connectionNodes: [] as PipeConnectionNode[],
    joints: [] as PipeJoint[],
    draftRevision: 0,
  });

  function setMessage(message: string) {
    state.message = message;
  }

  function clearMessage() {
    state.message = "";
  }

  function hydrateFromBackend(payload: PipelineBootstrapPayload) {
    state.points.splice(0, state.points.length, ...payload.points);
    state.lines.splice(0, state.lines.length, ...payload.lines);
    state.layers.splice(0, state.layers.length, ...payload.layers);
    state.businessTypes.splice(0, state.businessTypes.length, ...payload.businessTypes);
    state.connectionNodes = buildPipeConnectionNodes(state.lines);
    state.joints = payload.joints;
    state.nextPointIndex = getNextIndexFromIds(state.points.map((point) => point.id), "P");
    state.nextLineIndex = getNextIndexFromIds(state.lines.map((line) => line.id), "L");
    state.draftRevision += 1;

    if (state.selectedObject?.type === "point" && !getPointById(state.selectedObject.id)) {
      state.selectedObject = null;
    }
    if (state.selectedObject?.type === "line" && !getLineById(state.selectedObject.id)) {
      state.selectedObject = null;
    }
    if (state.selectedObject?.type === "joint" && !getJointById(state.selectedObject.id)) {
      state.selectedObject = null;
    }
  }

  function applyBackendMutation(payload: PipelineMutationPayload) {
    hydrateFromBackend(payload.bootstrap);

    if (payload.changedType === "point" && getPointById(payload.changedId)) {
      state.selectedObject = { type: "point", id: payload.changedId };
    } else if (payload.changedType === "line" && getLineById(payload.changedId)) {
      state.selectedObject = { type: "line", id: payload.changedId };
    } else if (payload.changedType === "joint" && getJointById(payload.changedId)) {
      state.selectedObject = { type: "joint", id: payload.changedId };
    }
  }

  function markLineDetailModelDirty(lineId: string) {
    const line = state.lines.find((candidate) => candidate.id === lineId);

    if (!line || line.detailModelStatus === "generating") {
      return;
    }

    if (line.detailTilesetUrl || line.detailModelStatus === "loaded" || line.detailModelStatus === "failed") {
      // 连接点变化会改变直管视觉切点；业务端点不动，只要求精细 3D Tiles 重新生成。
      line.detailModelStatus = "dirty";
      line.updatedAt = new Date().toISOString();
    }
  }

  function markLinesDirtyForJoint(joint: PipeJoint) {
    for (const lineId of joint.branchLineIds) {
      markLineDetailModelDirty(lineId);
    }
  }

  function markLinesDirtyForModelStyles(modelIds: string[]) {
    const modelIdSet = new Set(modelIds);
    let dirtyCount = 0;

    for (const line of state.lines) {
      if (!modelIdSet.has(line.modelId ?? DEFAULT_PIPE_MODEL_ID)) {
        continue;
      }

      const previousStatus = line.detailModelStatus;
      markLineDetailModelDirty(line.id);
      if (line.detailModelStatus === "dirty" && previousStatus !== "dirty") {
        dirtyCount += 1;
      }
    }

    return dirtyCount;
  }

  function refreshConnectionNodes() {
    // 连接节点是由当前管线端点派生的拓扑数据；后续接头模型自动适配会从这里读取。
    const previousJoints = state.joints;
    const previousById = new Map(previousJoints.map((joint) => [joint.id, joint]));
    const nodes = buildPipeConnectionNodes(state.lines);
    const nextJoints = buildPipeJoints(nodes, previousJoints);
    const nextIds = new Set(nextJoints.map((joint) => joint.id));

    for (const joint of nextJoints) {
      const previous = previousById.get(joint.id);
      if (!previous || previous.socketSignature !== joint.socketSignature) {
        markLinesDirtyForJoint(joint);
      }
    }

    for (const previous of previousJoints) {
      if (!nextIds.has(previous.id)) {
        // 连接点消失后，原先被 socket 回退的直管端点需要恢复到业务端点。
        markLinesDirtyForJoint(previous);
      }
    }

    state.connectionNodes = nodes;
    state.joints = nextJoints;
  }

  function setPipePointsVisible(visible: boolean) {
    // 管点显隐只影响 Cesium 中正式管点的显示，不删除业务数据，也不影响管点管理列表。
    state.showPipePoints = visible;
  }

  function clearDrafts() {
    // 切换工具时只清理临时点和端点；管线草稿属性保留，便于连续绘制同规格管线。
    state.pointDraft = null;
    state.lineDraft.start = null;
    state.lineDraft.end = null;
    state.draftRevision += 1;
  }

  function setActiveTool(tool: PipelineToolMode) {
    if (state.activeTool !== tool) {
      clearDrafts();
    }

    state.activeTool = tool;

    if (tool === "add-line" && state.points.length === 0 && state.lines.length === 0) {
      setMessage("请先添加管点");
      return;
    }

    clearMessage();
  }

  function setPointDraft(draft: PipePointDraft | null) {
    state.pointDraft = draft ? { ...draft, cartesian: markRaw(draft.cartesian) } : null;
  }

  function updatePointDraft(draft: PipePointDraft) {
    state.pointDraft = { ...draft, cartesian: markRaw(draft.cartesian) };
  }

  function confirmPoint() {
    if (!state.pointDraft) {
      setMessage("请先选择管点位置");
      return null;
    }

    const now = new Date().toISOString();
    // 管点先保留埋深、图层、业务字段，后续可对接 PipeSer 类数据模型。
    const point: PipePoint = {
      id: createPointId(state.nextPointIndex),
      lon: state.pointDraft.lon,
      lat: state.pointDraft.lat,
      height: state.pointDraft.height,
      groundHeight: state.pointDraft.groundHeight,
      relativeHeight: state.pointDraft.relativeHeight,
      maishen: 0,
      layerId: DEFAULT_PIPE_LAYER_ID,
      businessTypeId: DEFAULT_PIPE_BUSINESS_TYPE_ID,
      createdAt: now,
      updatedAt: now,
    };

    state.nextPointIndex += 1;
    state.points.push(point);
    state.pointDraft = null;
    state.selectedObject = { type: "point", id: point.id };
    setMessage(`已生成管点 ${point.id}`);

    return point;
  }

  function selectLineEndpoint(endpoint: PipeEndpoint) {
    // 第一次选择固定为起点；已有起点后再次选择则写入或替换终点。
    if (!state.lineDraft.start) {
      state.lineDraft.start = endpoint;
      setMessage(`已选择起点 ${endpoint.endpointKey}`);
      return;
    }

    state.lineDraft.end = endpoint;
    setMessage(`已选择终点 ${endpoint.endpointKey}`);
  }

  function clearLineEndpoint(role: "start" | "end") {
    state.lineDraft[role] = null;
    setMessage(role === "start" ? "已清除起点" : "已清除终点");
  }

  function cancelCurrentTool() {
    clearDrafts();
    state.activeTool = "none";
    clearMessage();
  }

  function confirmLine() {
    // 只有 validatePipeLineDraft 通过后才创建正式管线。
    const validation = validatePipeLineDraft(
      state.lineDraft.start,
      state.lineDraft.end,
      state.lines,
      state.lineDraft.businessTypeId,
    );

    if (!validation.ok) {
      setMessage(validation.message);
      return null;
    }

    const start = state.lineDraft.start as PipeEndpoint;
    const end = state.lineDraft.end as PipeEndpoint;
    const now = new Date().toISOString();
    const length = calculateLineLength({ start, end });
    // connectionKey 在创建时固化，后续重复校验直接比较该字段。
    const line: PipeLine = {
      id: createLineId(state.nextLineIndex),
      kind: "straight",
      start,
      end,
      startPointId: start.pointId,
      endPointId: end.pointId,
      layerId: DEFAULT_PIPE_LAYER_ID,
      businessTypeId: normalizePipeBusinessTypeId(state.lineDraft.businessTypeId),
      modelId: normalizePipeModelForBusiness(state.lineDraft.businessTypeId, state.lineDraft.modelId),
      shape: { ...state.lineDraft.shape },
      length,
      connectionKey: buildConnectionKey(start, end, state.lines),
      detailModelStatus: "none",
      createdAt: now,
      updatedAt: now,
    };

    state.nextLineIndex += 1;
    state.lines.push(line);
    refreshConnectionNodes();
    state.lineDraft.start = null;
    state.lineDraft.end = null;
    state.draftRevision += 1;
    state.selectedObject = { type: "line", id: line.id };
    setMessage(`已生成管线 ${line.id}`);

    return line;
  }

  function updateLineDraftModelParams(update: PipeLineModelUpdate) {
    if (
      !Number.isFinite(update.radius) ||
      !Number.isFinite(update.thickness) ||
      update.radius <= 0 ||
      update.thickness <= 0 ||
      update.thickness >= update.radius
    ) {
      setMessage("待生成管线外半径和壁厚参数无效");
      return false;
    }

    // 草稿属性是正式 PipeLine 的预设值；确认生成时会被复制到业务管线对象。
    state.lineDraft.shape = {
      type: "circle",
      radius: update.radius,
      thickness: update.thickness,
      flangeLength: state.lineDraft.shape.flangeLength,
      flangeThickness: state.lineDraft.shape.flangeThickness,
    };
    state.lineDraft.businessTypeId = normalizePipeBusinessTypeId(update.businessTypeId);
    state.lineDraft.modelId = normalizePipeModelForBusiness(
      state.lineDraft.businessTypeId,
      update.modelId,
    );
    state.draftRevision += 1;
    setMessage("已应用待生成管线属性");
    return true;
  }

  function getPointById(id: string) {
    return state.points.find((point) => point.id === id) ?? null;
  }

  function getLineById(id: string) {
    return state.lines.find((line) => line.id === id) ?? null;
  }

  function getConnectionNodeById(id: string) {
    return state.connectionNodes.find((node) => node.id === id) ?? null;
  }

  function getJointById(id: string) {
    return state.joints.find((joint) => joint.id === id) ?? null;
  }

  function getJointByNodeId(nodeId: string) {
    return state.joints.find((joint) => joint.nodeId === nodeId) ?? null;
  }

  function selectObject(object: SelectedPipelineObject | null) {
    state.selectedObject = object;
    if (object) {
      state.activeTool = "info";
    }
  }

  function selectJoint(id: string) {
    const joint = getJointById(id);
    if (!joint) {
      setMessage(`未找到连接点 ${id}`);
      return false;
    }

    state.selectedObject = { type: "joint", id };
    state.activeTool = "info";
    setMessage(`${joint.jointLabel}，连接 ${joint.degree} 条管线`);
    return true;
  }

  function setJointKind(id: string, jointKind: PipeJointKind) {
    const joint = getJointById(id);
    if (!joint) {
      setMessage(`未找到连接点 ${id}`);
      return false;
    }

    const allowedKinds = getEditableJointKindsByDegree(joint.degree);
    if (!allowedKinds.includes(jointKind)) {
      setMessage(`${getPipeJointKindLabel(jointKind)} 不适用于 ${joint.degree} 条管线的连接点`);
      return false;
    }

    // 手动指定连接类型后保留 override，后续拓扑刷新不会立刻把用户选择冲回自动推荐值。
    joint.jointKind = jointKind;
    joint.manualOverride = jointKind !== joint.recommendedJointKind;
    joint.jointLabel = getPipeJointKindLabel(jointKind);
    joint.geometrySignature = makeJointGeometrySignature(joint, {
      businessTypeId: joint.businessTypeId,
      modelId: joint.modelId,
    });
    // 保存连接类型后由 PipelineEditor 立即生成当前接头。
    // 即使旧请求仍在返回中，也要退出 generating 状态，避免新选择被旧生成锁挡住。
    joint.detailModelStatus = "dirty";
    joint.updatedAt = new Date().toISOString();
    state.selectedObject = { type: "joint", id };
    setMessage(`已更新连接点 ${id} 类型，正在重新生成当前接头`);
    return true;
  }

  function updateJointModelParams(id: string, update: PipeJointModelUpdate) {
    const joint = getJointById(id);
    if (!joint) {
      setMessage(`未找到连接点 ${id}`);
      return false;
    }

    const allowedBusinessTypeIds = new Set(
      joint.branches.map((branch) => normalizePipeBusinessTypeId(branch.businessTypeId)),
    );
    const businessTypeId = normalizePipeBusinessTypeId(update.businessTypeId);

    if (!allowedBusinessTypeIds.has(businessTypeId)) {
      setMessage("连接管业务类型必须来自相连管线");
      return false;
    }

    joint.businessTypeId = businessTypeId;
    joint.modelId = normalizePipeModelForBusiness(businessTypeId, update.modelId ?? joint.modelId);
    joint.geometrySignature = makeJointGeometrySignature(joint, {
      businessTypeId: joint.businessTypeId,
      modelId: joint.modelId,
    });
    // 外观保存同样只重建当前接头，并允许新请求接管仍在进行中的旧请求。
    joint.detailModelStatus = "dirty";
    joint.updatedAt = new Date().toISOString();
    state.selectedObject = { type: "joint", id };
    setMessage(`已更新连接点 ${id} 外观，正在重新生成当前接头`);
    return true;
  }

  function deletePoint(id: string) {
    // 第一版采用保守删除策略：被管线引用的管点禁止删除，避免拓扑断裂。
    const pointEndpointKey = buildPointEndpointKey(id);
    const linkedLine = state.lines.find(
      (line) =>
        resolveEndpointKey(line.start, state.lines) === pointEndpointKey ||
        resolveEndpointKey(line.end, state.lines) === pointEndpointKey,
    );

    if (linkedLine) {
      setMessage(`管点 ${id} 已被管线 ${linkedLine.id} 引用，请先删除关联管线`);
      return false;
    }

    const index = state.points.findIndex((point) => point.id === id);
    if (index >= 0) {
      state.points.splice(index, 1);
    }

    if (state.selectedObject?.type === "point" && state.selectedObject.id === id) {
      state.selectedObject = null;
    }

    setMessage(`已删除管点 ${id}`);
    return true;
  }

  function deleteLine(id: string) {
    // 如果其他管线吸附在本管线端点上，先禁止删除，避免产生悬空端点。
    const dependentLine = state.lines.find((line) => {
      if (line.id === id) {
        return false;
      }

      return (
        (line.start.sourceType === "line-endpoint" && line.start.sourceId === id) ||
        (line.end.sourceType === "line-endpoint" && line.end.sourceId === id)
      );
    });

    if (dependentLine) {
      setMessage(`管线 ${id} 的端点被管线 ${dependentLine.id} 引用，请先删除依赖管线`);
      return false;
    }

    const index = state.lines.findIndex((line) => line.id === id);
    if (index >= 0) {
      state.lines.splice(index, 1);
      refreshConnectionNodes();
    }

    if (state.selectedObject?.type === "line" && state.selectedObject.id === id) {
      state.selectedObject = null;
    }

    setMessage(`已删除管线 ${id}`);
    return true;
  }

  function requestFlyTo(type: "point" | "line", id: string) {
    state.flyToRequest = {
      type,
      id,
      nonce: Date.now(),
    };
  }

  function clearFlyToRequest() {
    // 定位请求是一次性事件；消费后清空，避免后续状态同步或组件重建误用旧请求。
    state.flyToRequest = null;
  }

  function setLineDetailModelState(
    id: string,
    status: PipeLine["detailModelStatus"],
    tilesetUrl?: string | null,
  ) {
    const line = getLineById(id);
    if (!line) {
      return false;
    }

    // 精细 3D Tiles 加载状态写回业务管线，renderer 据此隐藏普通 polylineVolume。
    line.detailModelStatus = status;
    if (tilesetUrl === null) {
      delete line.detailTilesetUrl;
    } else if (tilesetUrl !== undefined) {
      line.detailTilesetUrl = tilesetUrl;
    }
    line.updatedAt = new Date().toISOString();
    return true;
  }

  function setJointDetailModelState(
    id: string,
    status: PipeJointModelStatus,
    tilesetUrl?: string | null,
  ) {
    const joint = getJointById(id);
    if (!joint) {
      return false;
    }

    // 接头 3D Tiles 加载状态写回业务接头，renderer 据此隐藏 entity 占位模型。
    joint.detailModelStatus = status;
    if (tilesetUrl === null) {
      delete joint.detailTilesetUrl;
    } else if (tilesetUrl !== undefined) {
      joint.detailTilesetUrl = tilesetUrl;
    }
    joint.updatedAt = new Date().toISOString();
    return true;
  }

  function validateLineModelUpdate(id: string, update: PipeLineModelUpdate) {
    const line = getLineById(id);
    if (!line) {
      setMessage(`未找到管线 ${id}`);
      return false;
    }

    const currentBusinessTypeId = normalizePipeBusinessTypeId(line.businessTypeId);
    const businessTypeId = normalizePipeBusinessTypeId(update.businessTypeId);

    if (
      businessTypeId !== currentBusinessTypeId &&
      !canUpdateLineBusinessType(line, state.lines, businessTypeId)
    ) {
      setMessage("该管线连接点已存在其他业务类型，无法切换业务类型");
      return false;
    }

    return true;
  }

  function updateLineModelParams(id: string, update: PipeLineModelUpdate) {
    const line = getLineById(id);
    if (!line || !validateLineModelUpdate(id, update)) {
      return null;
    }

    // 第一版精细建模只支持圆管；参数编辑统一写回圆管半径、壁厚和业务类型。
    const hadLoadedTileset = Boolean(line.detailTilesetUrl);
    const businessTypeId = normalizePipeBusinessTypeId(update.businessTypeId);

    line.shape = {
      type: "circle",
      radius: update.radius,
      thickness: update.thickness,
      flangeLength: line.shape.flangeLength,
      flangeThickness: line.shape.flangeThickness,
    };
    line.businessTypeId = businessTypeId;
    line.modelId = normalizePipeModelForBusiness(businessTypeId, update.modelId ?? line.modelId);
    line.detailModelStatus = hadLoadedTileset ? "dirty" : line.detailModelStatus;
    line.updatedAt = new Date().toISOString();
    refreshConnectionNodes();

    return line;
  }

  return {
    state,
    hydrateFromBackend,
    applyBackendMutation,
    setActiveTool,
    setPointDraft,
    updatePointDraft,
    confirmPoint,
    selectLineEndpoint,
    clearLineEndpoint,
    cancelCurrentTool,
    confirmLine,
    getPointById,
    getLineById,
    getConnectionNodeById,
    getJointById,
    getJointByNodeId,
    selectObject,
    selectJoint,
    setJointKind,
    updateJointModelParams,
    deletePoint,
    deleteLine,
    requestFlyTo,
    clearFlyToRequest,
    setLineDetailModelState,
    setJointDetailModelState,
    markLinesDirtyForModelStyles,
    updateLineDraftModelParams,
    validateLineModelUpdate,
    updateLineModelParams,
    setPipePointsVisible,
    refreshConnectionNodes,
    setMessage,
    clearMessage,
  };
}

export type PipelineStore = ReturnType<typeof createPipelineStore>;
