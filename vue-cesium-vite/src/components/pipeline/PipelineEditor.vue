<template>
  <div class="pipeline-editor">
    <div class="pipeline-editor__top">
      <PipeToolbar
        :active-tool="store.state.activeTool"
        :show-pipe-points="store.state.showPipePoints"
        @select-tool="store.setActiveTool"
        @toggle-points-visible="store.setPipePointsVisible"
      />
    </div>

    <div class="pipeline-editor__camera">
      <PipeCameraToolbar @change-view="cameraControls?.flyToView($event)" />
    </div>

    <div class="pipeline-editor__surface">
      <PipeSurfaceTransparencyPanel
        :opacity="surfaceOpacity"
        @update:opacity="setSurfaceOpacity"
        @reset="surfaceTransparency.reset"
      />
    </div>

    <div class="pipeline-editor__left">
      <PipePointManager
        v-if="store.state.activeTool === 'point-manager'"
        :points="store.state.points"
        @select="selectPoint"
        @fly-to="(id) => store.requestFlyTo('point', id)"
        @delete="deletePointWithBackend"
      />

      <PipeLineManager
        v-if="store.state.activeTool === 'line-manager'"
        :lines="store.state.lines"
        @select="selectLine"
        @fly-to="focusLine"
        @regenerate="regenerateExistingLineModel"
        @delete="deleteLineAndTilesetWithBackend"
      />

      <PipeMaterialPanel
        v-if="store.state.activeTool === 'material'"
        :business-types="store.state.businessTypes"
      />

      <PipeImportPanel
        v-if="store.state.activeTool === 'import'"
        @committed="handleImportCommitted"
        @generate-project="generateProjectTiles"
        @message="store.setMessage"
      />

    </div>

    <div class="pipeline-editor__right">
      <PipeInfoPanel
        v-if="store.state.activeTool === 'info' || store.state.selectedObject || store.state.activeTool === 'add-line'"
        :active-tool="store.state.activeTool"
        :selected-object="store.state.selectedObject"
        :line-draft="store.state.lineDraft"
        :points="store.state.points"
        :lines="store.state.lines"
        :joints="store.state.joints"
        :business-types="store.state.businessTypes"
        :model-options="pipeModelOptions"
        @save-line-draft-model="store.updateLineDraftModelParams"
        @save-line-model="saveLineModelParamsWithBackend"
        @regenerate-line-model="regenerateLineModel"
        @save-joint-kind="saveJointKindWithBackend"
        @save-joint-model="saveJointModelParamsWithBackend"
        @regenerate-joint-model="regenerateJointModel"
      />
    </div>

    <div v-if="store.state.message" class="pipeline-editor__message">
      {{ store.state.message }}
    </div>

    <PipeBottomPanel
      :active-tool="store.state.activeTool"
      :point-draft="store.state.pointDraft"
      :line-draft="store.state.lineDraft"
      @cancel="store.cancelCurrentTool"
      @confirm-point="confirmPointWithBackend"
      @confirm-line="confirmLineWithBackendAndGenerateTiles"
      @clear-endpoint="store.clearLineEndpoint"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import type { Viewer } from "cesium";
import type {
  PipeJoint,
  PipeJointKind,
  PipeJointModelUpdate,
  PipeLine,
  PipeLineModelUpdate,
  PipelineMutationPayload,
} from "../../types/pipeline";
import {
  createPipelineLine,
  createPipelinePoint,
  deletePipelineLine,
  deletePipelinePoint,
  fetchPipelineBootstrap,
  generatePipelineProjectTiles,
  generatePipelineTiles,
  updatePipelineJointKind,
  updatePipelineJointModel,
  updatePipelineLineModel,
} from "../../api/pipeline";
import PipeBottomPanel from "./PipeBottomPanel.vue";
import PipeCameraToolbar from "./PipeCameraToolbar.vue";
import PipeInfoPanel from "./PipeInfoPanel.vue";
import PipeImportPanel from "./PipeImportPanel.vue";
import PipeLineManager from "./PipeLineManager.vue";
import PipeMaterialPanel from "./PipeMaterialPanel.vue";
import PipePointManager from "./PipePointManager.vue";
import PipeSurfaceTransparencyPanel from "./PipeSurfaceTransparencyPanel.vue";
import PipeToolbar from "./PipeToolbar.vue";
import { PIPE_MODEL_OPTIONS } from "../../constants/pipelineModelOptions";
import { useCesiumCameraOrbit } from "../../composables/useCesiumCameraOrbit";
import { useCesiumCameraControls } from "../../composables/useCesiumCameraControls";
import { useCesiumPipelineInteraction } from "../../composables/useCesiumPipelineInteraction";
import { useCesiumPipelineRenderer } from "../../composables/useCesiumPipelineRenderer";
import { useCesiumSurfaceTransparency } from "../../composables/useCesiumSurfaceTransparency";
import { usePipelineTilesetDemo } from "../../composables/usePipelineTilesetDemo";
import { createPipelineStore } from "../../composables/usePipelineStore";
import { validatePipeLineDraft } from "../../utils/pipelineValidation";

const props = defineProps<{
  viewer: Viewer;
}>();

const store = createPipelineStore();
const tilesetDemo = usePipelineTilesetDemo(props.viewer);
const surfaceTransparency = useCesiumSurfaceTransparency(props.viewer);
const surfaceOpacity = surfaceTransparency.opacity;
const pipeModelOptions = PIPE_MODEL_OPTIONS;
let renderer: ReturnType<typeof useCesiumPipelineRenderer> | null = null;
let interaction: ReturnType<typeof useCesiumPipelineInteraction> | null = null;
let cameraControls: ReturnType<typeof useCesiumCameraControls> | null = null;
let cameraOrbit: ReturnType<typeof useCesiumCameraOrbit> | null = null;
const lineGenerationTokens = new Map<string, symbol>();
const jointGenerationTokens = new Map<string, symbol>();
const legacyTemplateModelIds = ["pipe-pp-pvc"];

// PP/PVC 已从直管模板改为外观风格；旧 tileset 需要用户重新生成，避免继续显示旧 GLB 几何。
const dirtyLegacyModelCount = store.markLinesDirtyForModelStyles(legacyTemplateModelIds);
if (dirtyLegacyModelCount > 0) {
  store.setMessage(`已标记 ${dirtyLegacyModelCount} 条旧 PP/PVC 精细模型为需重新生成`);
}

const stopTilesetSelectionSync = watch(
  () => store.state.selectedObject,
  (selectedObject) => {
    // 业务选中状态统一驱动精细 3D Tiles 高亮；未选中管线或连接管时恢复默认材质。
    tilesetDemo.setSelectedGeneratedObject(
      selectedObject?.type === "line" || selectedObject?.type === "joint"
        ? { type: selectedObject.type, id: selectedObject.id }
        : null,
    );
  },
  { immediate: true },
);

function beginLineGeneration(lineId: string) {
  const token = Symbol(lineId);
  lineGenerationTokens.set(lineId, token);
  return token;
}

function isCurrentLineGeneration(lineId: string, token: symbol) {
  return lineGenerationTokens.get(lineId) === token;
}

function finishLineGeneration(lineId: string, token: symbol) {
  // 只允许当前请求清理自己的 token，避免旧请求结束时误清理新请求的锁。
  if (isCurrentLineGeneration(lineId, token)) {
    lineGenerationTokens.delete(lineId);
  }
}

function cancelLineGeneration(lineId: string) {
  // 删除管线时立即让未完成的生成请求失效，异步返回后不会再写入 store 或留下孤儿模型。
  lineGenerationTokens.delete(lineId);
}

function beginJointGeneration(jointId: string) {
  const token = Symbol(jointId);
  jointGenerationTokens.set(jointId, token);
  return token;
}

function cancelJointGeneration(jointId: string) {
  jointGenerationTokens.delete(jointId);
}

function resetJointGenerationState(jointId: string) {
  cancelJointGeneration(jointId);
  const joint = store.getJointById(jointId);
  if (joint && joint.detailModelStatus === "generating") {
    store.setJointDetailModelState(jointId, joint.detailTilesetUrl ? "dirty" : "none", joint.detailTilesetUrl ?? null);
  }
}

function isCurrentJointGeneration(jointId: string, token: symbol) {
  return jointGenerationTokens.get(jointId) === token;
}

function finishJointGeneration(jointId: string, token: symbol) {
  if (isCurrentJointGeneration(jointId, token)) {
    jointGenerationTokens.delete(jointId);
  }
}

function selectPoint(id: string) {
  store.selectObject({ type: "point", id });
}

function selectLine(id: string) {
  store.selectObject({ type: "line", id });
}

async function loadBootstrapFromBackend() {
  try {
    const payload = await fetchPipelineBootstrap();
    store.hydrateFromBackend(payload);
    store.setMessage("已从后端加载管网数据");
    await loadBootstrapTilesets();
  } catch (error) {
    store.setMessage(`后端数据加载失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadBootstrapTilesets() {
  for (const line of store.state.lines) {
    if (line.detailTilesetUrl && line.detailModelStatus === "loaded") {
      try {
        await tilesetDemo.loadGeneratedLineTileset(
          line.detailTilesetUrl,
          `${line.id} 精细 3D Tiles`,
          line.id,
          { flyTo: false },
        );
      } catch {
        store.setLineDetailModelState(line.id, "failed", line.detailTilesetUrl);
      }
    }
  }

  for (const joint of store.state.joints) {
    if (joint.detailTilesetUrl && joint.detailModelStatus === "loaded") {
      try {
        await tilesetDemo.loadGeneratedJointTileset(joint.detailTilesetUrl, `${joint.jointLabel} 3D Tiles`, joint.id);
      } catch {
        store.setJointDetailModelState(joint.id, "failed", joint.detailTilesetUrl);
      }
    }
  }
}

function applyBackendMutationAndUnloadStale(payload: PipelineMutationPayload, previousJointUrls: string[] = []) {
  store.applyBackendMutation(payload);
  unloadStaleJointTilesets(previousJointUrls);
}

async function confirmPointWithBackend() {
  const draft = store.state.pointDraft;
  if (!draft) {
    store.setMessage("请先选择管点位置");
    return;
  }

  try {
    const payload = await createPipelinePoint({
      lon: draft.lon,
      lat: draft.lat,
      height: draft.height,
      groundHeight: draft.groundHeight,
      relativeHeight: draft.relativeHeight,
      maishen: 0,
      businessTypeId: store.state.lineDraft.businessTypeId,
    });
    store.state.pointDraft = null;
    store.applyBackendMutation(payload);
    store.setMessage(`已保存管点 ${payload.changedId}`);
  } catch (error) {
    store.setMessage(`管点保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function deletePointWithBackend(id: string) {
  try {
    const payload = await deletePipelinePoint(id);
    store.applyBackendMutation(payload);
    store.setMessage(`已删除管点 ${id}`);
  } catch (error) {
    store.setMessage(`删除管点失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function setSurfaceOpacity(opacity: number) {
  // 面板只发出用户选择的数值，真正改 Cesium globe 的逻辑集中在 composable 中。
  surfaceTransparency.setOpacity(opacity);
}

async function focusLine(id: string) {
  const line = store.getLineById(id);

  if (!line) {
    store.setMessage(`未找到管线 ${id}`);
    return;
  }

  const didFlyToTileset = line.detailTilesetUrl
    ? await tilesetDemo.flyToGeneratedLineTileset(line.detailTilesetUrl)
    : false;

  if (!didFlyToTileset) {
    renderer?.flyToLine(id);
  }

  store.selectObject({ type: "line", id });
}

async function confirmLineAndGenerateTiles() {
  const line = store.confirmLine();
  if (!line) {
    return;
  }

  renderer?.clearPreviewLine();
  const generationToken = beginLineGeneration(line.id);

  try {
    store.setMessage(`已生成管线 ${line.id}，正在生成精细 3D Tiles...`);
    store.setLineDetailModelState(line.id, "generating", null);
    const result = await generateLineTileset(line);

    if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
      return;
    }

    // 生成成功后直接加载对应 tileset，使新增管线立即出现精细模型。
    await tilesetDemo.loadGeneratedLineTileset(result.url, `${line.id} 精细 3D Tiles`, line.id);

    if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
      // 加载过程中如果业务管线已被删除，立刻卸载刚加载的 tileset，避免场景中出现不可管理模型。
      tilesetDemo.unloadGeneratedLineTileset(result.url);
      return;
    }

    store.setLineDetailModelState(line.id, "loaded", result.url);
    store.setMessage(`已生成并加载 ${line.id} 精细 3D Tiles`);
    await generatePendingLineTilesets();
    await generatePendingJointTilesets();
  } catch (error) {
    if (isCurrentLineGeneration(line.id, generationToken) && store.getLineById(line.id)) {
      store.setLineDetailModelState(line.id, "failed", null);
      store.setMessage(
        `管线 ${line.id} 已生成，但精细 3D Tiles 生成失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } finally {
    finishLineGeneration(line.id, generationToken);
  }
}

async function confirmLineWithBackendAndGenerateTiles() {
  const validation = validatePipeLineDraft(
    store.state.lineDraft.start,
    store.state.lineDraft.end,
    store.state.lines,
    store.state.lineDraft.businessTypeId,
  );

  if (!validation.ok) {
    store.setMessage(validation.message);
    return;
  }

  const draft = {
    start: store.state.lineDraft.start!,
    end: store.state.lineDraft.end!,
    businessTypeId: store.state.lineDraft.businessTypeId,
    modelId: store.state.lineDraft.modelId,
    shape: { ...store.state.lineDraft.shape },
  };

  try {
    const mutation = await createPipelineLine({
      start: draft.start,
      end: draft.end,
      businessTypeId: draft.businessTypeId,
      modelId: draft.modelId,
      shape: draft.shape,
    });
    store.applyBackendMutation(mutation);
    store.state.lineDraft.start = null;
    store.state.lineDraft.end = null;
    store.state.draftRevision += 1;
    renderer?.clearPreviewLine();

    const line = store.getLineById(mutation.changedId);
    if (!line) {
      store.setMessage("后端已保存管线，但前端缓存未找到该管线");
      return;
    }

    const generationToken = beginLineGeneration(line.id);
    try {
      store.setMessage(`已保存管线 ${line.id}，正在生成精细 3D Tiles...`);
      store.setLineDetailModelState(line.id, "generating", null);
      const result = await generateLineTileset(line);

      if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
        return;
      }

      await tilesetDemo.loadGeneratedLineTileset(result.url, `${line.id} 精细 3D Tiles`, line.id);

      if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
        tilesetDemo.unloadGeneratedLineTileset(result.url);
        return;
      }

      store.setLineDetailModelState(line.id, "loaded", result.url);
      store.setMessage(`已生成并加载 ${line.id} 精细 3D Tiles`);
      await generatePendingLineTilesets();
      await generatePendingJointTilesets();
    } catch (error) {
      if (isCurrentLineGeneration(line.id, generationToken) && store.getLineById(line.id)) {
        store.setLineDetailModelState(line.id, "failed", null);
        store.setMessage(`管线 ${line.id} 已保存，但精细模型生成失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      finishLineGeneration(line.id, generationToken);
    }
  } catch (error) {
    store.setMessage(`管线保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function generateLineTileset(line: PipeLine, outputSubdir?: string) {
  return generatePipelineTiles({
    targetType: "line",
    targetId: line.id,
    outputSubdir,
  });
}

async function regenerateDirtyLineModel(id: string, options: { flyTo?: boolean } = {}) {
  const line = store.getLineById(id);
  if (!line || lineGenerationTokens.has(line.id) || line.detailModelStatus === "generating") {
    return;
  }

  const previousTilesetUrl = line.detailTilesetUrl;
  const outputSubdir = `${line.id}-${Date.now()}`;
  const generationToken = beginLineGeneration(line.id);

  try {
    if (previousTilesetUrl) {
      // The old tileset was generated from stale socket/cutback geometry.
      // Remove it before regeneration so the visible rough entity is the current geometry source of truth.
      tilesetDemo.unloadGeneratedLineTileset(previousTilesetUrl);
    }
    // socket 切点变化只影响精细模型文件，不改变管线业务起终点。
    store.setLineDetailModelState(line.id, "generating", null);
    const result = await generateLineTileset(line, outputSubdir);

    if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
      return;
    }

    await tilesetDemo.loadGeneratedLineTileset(
      result.url,
      `${line.id} 精细 3D Tiles`,
      line.id,
      { flyTo: options.flyTo ?? true },
    );

    if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
      tilesetDemo.unloadGeneratedLineTileset(result.url);
      return;
    }

    // previousTilesetUrl was unloaded before generation to avoid stale tiles overlapping the current entity.

    store.setLineDetailModelState(line.id, "loaded", result.url);
  } catch (error) {
    if (isCurrentLineGeneration(line.id, generationToken) && store.getLineById(line.id)) {
      store.setLineDetailModelState(line.id, "failed", null);
      store.setMessage(
        `管线 ${line.id} socket 切点重建失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    finishLineGeneration(line.id, generationToken);
  }
}

async function generatePendingLineTilesets() {
  const pendingLines = store.state.lines.filter(
    (line) => !lineGenerationTokens.has(line.id) && line.detailModelStatus === "dirty",
  );

  // socket/cutback 真变化时才批量重建周边直管；后台批量生成不移动相机。
  await Promise.all(pendingLines.map((line) => regenerateDirtyLineModel(line.id, { flyTo: false })));
}

async function generateJointTileset(joint: PipeJoint, outputSubdir?: string) {
  return generatePipelineTiles({
    targetType: "joint",
    targetId: joint.id,
    outputSubdir,
  });
}

async function generateJointModel(jointId: string) {
  const joint = store.getJointById(jointId);
  if (!joint || joint.detailModelStatus === "generating") {
    return;
  }

  const previousTilesetUrl = joint.detailTilesetUrl;
  const geometrySignature = joint.geometrySignature;
  const outputSubdir = `${joint.id}-${Date.now()}`;
  const generationToken = beginJointGeneration(joint.id);

  try {
    if (previousTilesetUrl) {
      tilesetDemo.unloadGeneratedJointTileset(previousTilesetUrl);
    }
    // 重新生成期间先显示 entity fallback，避免旧精细模型继续冒充当前接头类型。
    store.setJointDetailModelState(joint.id, "generating");
    const result = await generateJointTileset(joint, outputSubdir);

    const currentAfterGenerate = store.getJointById(joint.id);
    if (
      !isCurrentJointGeneration(joint.id, generationToken) ||
      !currentAfterGenerate ||
      currentAfterGenerate.geometrySignature !== geometrySignature
    ) {
      if (
        isCurrentJointGeneration(joint.id, generationToken) &&
        currentAfterGenerate &&
        currentAfterGenerate.geometrySignature !== geometrySignature
      ) {
        store.setJointDetailModelState(joint.id, "dirty");
      }
      return;
    }

    await tilesetDemo.loadGeneratedJointTileset(result.url, `${joint.jointLabel} 3D Tiles`, joint.id);

    const currentAfterLoad = store.getJointById(joint.id);
    if (
      !isCurrentJointGeneration(joint.id, generationToken) ||
      !currentAfterLoad ||
      currentAfterLoad.geometrySignature !== geometrySignature
    ) {
      // 如果加载期间拓扑已经变化，刚加载的旧接头模型不能进入当前场景状态。
      tilesetDemo.unloadGeneratedJointTileset(result.url);
      if (
        isCurrentJointGeneration(joint.id, generationToken) &&
        currentAfterLoad &&
        currentAfterLoad.geometrySignature !== geometrySignature
      ) {
        store.setJointDetailModelState(joint.id, "dirty");
      }
      return;
    }

    store.setJointDetailModelState(joint.id, "loaded", result.url);
    await generatePendingLineTilesets();
    store.setMessage(`已重新生成并加载 ${joint.jointLabel} 3D Tiles`);
  } catch (error) {
    if (isCurrentJointGeneration(joint.id, generationToken) && store.getJointById(joint.id)) {
      store.setJointDetailModelState(joint.id, "failed");
      store.setMessage(
        `${joint.jointLabel} 重新生成失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    finishJointGeneration(joint.id, generationToken);
  }
}

function saveJointKind(id: string, jointKind: PipeJointKind) {
  if (!store.setJointKind(id, jointKind)) {
    return;
  }

  resetJointGenerationState(id);
  void generateJointModel(id);
}

async function saveJointKindWithBackend(id: string, jointKind: PipeJointKind) {
  try {
    const previousJointUrls = getLoadedJointTilesetUrls();
    const payload = await updatePipelineJointKind(id, jointKind);
    applyBackendMutationAndUnloadStale(payload, previousJointUrls);
    resetJointGenerationState(id);
    await generateJointModel(id);
  } catch (error) {
    store.setMessage(`连接点类型保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function saveJointModelParams(id: string, update: PipeJointModelUpdate) {
  if (!store.updateJointModelParams(id, update)) {
    return;
  }

  resetJointGenerationState(id);
  void generateJointModel(id);
}

async function saveJointModelParamsWithBackend(id: string, update: PipeJointModelUpdate) {
  try {
    const previousJointUrls = getLoadedJointTilesetUrls();
    const payload = await updatePipelineJointModel(id, update);
    applyBackendMutationAndUnloadStale(payload, previousJointUrls);
    resetJointGenerationState(id);
    await generateJointModel(id);
  } catch (error) {
    store.setMessage(`连接管外观保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function regenerateJointModel(id: string) {
  await generateJointModel(id);
}

async function generatePendingJointTilesets() {
  const pendingJoints = store.state.joints.filter(
    (joint) =>
      !jointGenerationTokens.has(joint.id) &&
      (joint.detailModelStatus === "none" ||
        joint.detailModelStatus === "dirty" ||
        joint.detailModelStatus === "failed"),
  );

  // 接头通常数量不多，顺序生成能降低同时写文件和加载 tileset 的复杂度。
  for (const joint of pendingJoints) {
    await generateJointModel(joint.id);
  }
}

function getLoadedJointTilesetUrls() {
  return store.state.joints
    .map((joint) => joint.detailTilesetUrl)
    .filter((url): url is string => Boolean(url));
}

function getLoadedLineTilesetUrls() {
  return store.state.lines
    .map((line) => line.detailTilesetUrl)
    .filter((url): url is string => Boolean(url));
}

function unloadStaleLineTilesets(previousLineUrls: string[]) {
  const currentLineUrls = new Set(getLoadedLineTilesetUrls());

  for (const url of previousLineUrls) {
    if (!currentLineUrls.has(url)) {
      tilesetDemo.unloadGeneratedLineTileset(url);
    }
  }
}

function unloadStaleJointTilesets(previousJointUrls: string[]) {
  const currentJointUrls = new Set(getLoadedJointTilesetUrls());

  for (const url of previousJointUrls) {
    if (!currentJointUrls.has(url)) {
      tilesetDemo.unloadGeneratedJointTileset(url);
    }
  }
}

async function handleImportCommitted(payload: PipelineMutationPayload, autoGenerate: boolean) {
  const previousLineUrls = getLoadedLineTilesetUrls();
  const previousJointUrls = getLoadedJointTilesetUrls();
  store.applyBackendMutation(payload);
  unloadStaleLineTilesets(previousLineUrls);
  unloadStaleJointTilesets(previousJointUrls);
  store.setMessage("导入已提交，正在刷新地图管网");
  await loadBootstrapTilesets();

  if (autoGenerate) {
    await generateProjectTiles();
  }
}

async function generateProjectTiles() {
  try {
    store.setMessage("正在批量生成当前项目精细模型...");
    const previousLineUrls = getLoadedLineTilesetUrls();
    const previousJointUrls = getLoadedJointTilesetUrls();
    const job = await generatePipelineProjectTiles();
    const payload = await fetchPipelineBootstrap();
    store.hydrateFromBackend(payload);
    unloadStaleLineTilesets(previousLineUrls);
    unloadStaleJointTilesets(previousJointUrls);
    await loadBootstrapTilesets();
    store.setMessage(job.failedCount > 0
      ? `批量生成完成，失败 ${job.failedCount} 项`
      : "批量生成完成，已加载精细模型");
  } catch (error) {
    store.setMessage(`批量生成失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function createPreviewLineWithUpdate(line: PipeLine, update: PipeLineModelUpdate): PipeLine {
  // 重新生成前先构造临时管线对象，不立即改 store，避免生成失败导致业务参数半更新。
  return {
    ...line,
    kind: "straight",
    businessTypeId: update.businessTypeId,
    modelId: update.modelId ?? line.modelId,
    shape: {
      type: "circle",
      radius: update.radius,
      thickness: update.thickness,
      flangeLength: line.shape.flangeLength,
      flangeThickness: line.shape.flangeThickness,
    },
  };
}

function createModelUpdateFromLine(line: PipeLine): PipeLineModelUpdate {
  // 管线管理面板没有表单草稿，因此重新生成时直接使用当前业务管线中已保存的建模参数。
  if (line.shape.type === "circle") {
    return {
      radius: line.shape.radius,
      thickness: line.shape.thickness,
      businessTypeId: line.businessTypeId,
      modelId: line.modelId,
    };
  }

  // 第一版精细模型只支持圆管；方管进入重新生成时按外接圆半径降级，和配置生成器保持一致。
  return {
    radius: Math.max(line.shape.width, line.shape.height) / 2,
    thickness: line.shape.thickness,
    businessTypeId: line.businessTypeId,
    modelId: line.modelId,
  };
}

async function saveLineModelParamsWithBackend(id: string, update: PipeLineModelUpdate) {
  if (!store.validateLineModelUpdate(id, update)) {
    return;
  }

  try {
    const previousJointUrls = getLoadedJointTilesetUrls();
    const payload = await updatePipelineLineModel(id, update);
    applyBackendMutationAndUnloadStale(payload, previousJointUrls);
    store.setMessage(`已保存 ${id} 参数，精细模型需要重新生成`);
  } catch (error) {
    store.setMessage(`管线参数保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function saveLineModelParams(id: string, update: PipeLineModelUpdate) {
  const previousJointUrls = getLoadedJointTilesetUrls();
  const line = store.updateLineModelParams(id, update);
  if (!line) {
    store.setMessage(`未找到管线 ${id}`);
    return;
  }

  unloadStaleJointTilesets(previousJointUrls);
  // 保存参数只标记数据已变更；用户点击“重新生成”后才替换精细 3D Tiles。
  store.setMessage(`已保存 ${id} 参数，精细模型需重新生成`);
}

function regenerateExistingLineModel(id: string) {
  const line = store.getLineById(id);
  if (!line) {
    store.setMessage(`未找到管线 ${id}`);
    return;
  }

  void regenerateLineModel(line.id, createModelUpdateFromLine(line));
}

async function regenerateLineModel(id: string, update: PipeLineModelUpdate) {
  const line = store.getLineById(id);
  if (!line) {
    store.setMessage(`未找到管线 ${id}`);
    return;
  }

  if (lineGenerationTokens.has(line.id) || line.detailModelStatus === "generating") {
    store.setMessage(`管线 ${line.id} 正在生成精细模型，请稍后再试`);
    return;
  }

  if (!store.validateLineModelUpdate(line.id, update)) {
    return;
  }

  const previousTilesetUrl = line.detailTilesetUrl;
  const outputSubdir = `${line.id}-${Date.now()}`;
  const generationToken = beginLineGeneration(line.id);

  try {
    store.setMessage(`正在重新生成 ${line.id} 精细 3D Tiles...`);
    if (previousTilesetUrl) {
      // Parameter changes make the previous refined model visually stale.
      // Drop it first so the entity fallback and the upcoming tileset use the same geometry.
      tilesetDemo.unloadGeneratedLineTileset(previousTilesetUrl);
    }
    store.setLineDetailModelState(line.id, "generating", null);
    const payload = await updatePipelineLineModel(line.id, update);
    store.applyBackendMutation(payload);
    const currentLine = store.getLineById(line.id);
    if (!currentLine) {
      return;
    }
    const result = await generateLineTileset(currentLine, outputSubdir);

    if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
      return;
    }

    await tilesetDemo.loadGeneratedLineTileset(result.url, `${line.id} 精细 3D Tiles`, line.id);

    if (!isCurrentLineGeneration(line.id, generationToken) || !store.getLineById(line.id)) {
      // 加载过程中如果管线被删除或请求已过期，卸载新 tileset，避免同一业务线残留多套模型。
      tilesetDemo.unloadGeneratedLineTileset(result.url);
      return;
    }

    const previousJointUrls = getLoadedJointTilesetUrls();
    unloadStaleJointTilesets(previousJointUrls);
    store.setLineDetailModelState(line.id, "loaded", result.url);
    store.setMessage(`已重新生成并加载 ${line.id} 精细 3D Tiles`);
    await generatePendingLineTilesets();
    await generatePendingJointTilesets();
  } catch (error) {
    if (isCurrentLineGeneration(line.id, generationToken) && store.getLineById(line.id)) {
      store.setLineDetailModelState(line.id, "failed", null);
      store.setMessage(
        `管线 ${line.id} 重新生成失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    finishLineGeneration(line.id, generationToken);
  }
}

async function deleteLineAndTileset(id: string) {
  const line = store.getLineById(id);
  const tilesetUrl = line?.detailTilesetUrl;
  const previousJointUrls = getLoadedJointTilesetUrls();

  if (!store.deleteLine(id)) {
    return;
  }

  cancelLineGeneration(id);

  if (tilesetUrl) {
    tilesetDemo.unloadGeneratedLineTileset(tilesetUrl);
  }

  // 删除管线会重算拓扑；只卸载已经不再被任何当前接头引用的旧模型，避免误删未受影响的接头。
  unloadStaleJointTilesets(previousJointUrls);

  await generatePendingLineTilesets();
  await generatePendingJointTilesets();
}

async function deleteLineAndTilesetWithBackend(id: string) {
  const line = store.getLineById(id);
  const tilesetUrl = line?.detailTilesetUrl;
  const previousJointUrls = getLoadedJointTilesetUrls();

  try {
    const payload = await deletePipelineLine(id);
    cancelLineGeneration(id);

    if (tilesetUrl) {
      tilesetDemo.unloadGeneratedLineTileset(tilesetUrl);
    }

    applyBackendMutationAndUnloadStale(payload, previousJointUrls);
    store.setMessage(`已删除管线 ${id}`);
    await generatePendingLineTilesets();
    await generatePendingJointTilesets();
  } catch (error) {
    store.setMessage(`删除管线失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

onMounted(() => {
  renderer = useCesiumPipelineRenderer(props.viewer, store);
  interaction = useCesiumPipelineInteraction(
    props.viewer,
    store,
    tilesetDemo.getLineIdFromPickedObject,
    tilesetDemo.getJointIdFromPickedObject,
  );
  cameraControls = useCesiumCameraControls(props.viewer, store);
  cameraOrbit = useCesiumCameraOrbit(props.viewer, store);
  void loadBootstrapFromBackend();
});

onUnmounted(() => {
  stopTilesetSelectionSync();
  cameraOrbit?.destroy();
  surfaceTransparency.destroy();
  interaction?.destroy();
  renderer?.destroy();
  tilesetDemo.destroy();
});
</script>

<style scoped>
.pipeline-editor {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: Arial, "Microsoft YaHei", sans-serif;
}

.pipeline-editor > * {
  pointer-events: auto;
}

.pipeline-editor__top {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
}

.pipeline-editor__camera {
  position: absolute;
  top: 74px;
  left: 50%;
  transform: translateX(-50%);
}

.pipeline-editor__surface {
  position: absolute;
  top: 74px;
  right: 18px;
}

.pipeline-editor__left {
  position: absolute;
  top: 120px;
  left: 18px;
}

.pipeline-editor__right {
  position: absolute;
  top: 120px;
  right: 18px;
}

.pipeline-editor__message {
  position: absolute;
  top: 120px;
  left: 50%;
  max-width: 520px;
  padding: 10px 14px;
  color: #ffffff;
  background: rgba(24, 38, 48, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  transform: translateX(-50%);
  backdrop-filter: blur(8px);
}
</style>
