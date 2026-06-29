<template>
  <section class="pipe-info-panel">
    <header>
      <h2>管道信息</h2>
    </header>

    <div v-if="!selectedObject && !isEditingLineDraft" class="pipe-info-panel__empty">未选择对象</div>

    <dl v-else-if="isEditingLineDraft">
      <dt>类型</dt>
      <dd>待生成管线</dd>
      <dt>管线类型</dt>
      <dd>直管</dd>
      <dt>起点</dt>
      <dd>{{ formatEndpointLabel(lineDraft.start) }}</dd>
      <dt>终点</dt>
      <dd>{{ formatEndpointLabel(lineDraft.end) }}</dd>
      <dt>预计长度</dt>
      <dd>{{ draftLineLengthText }}</dd>
      <dt>断面</dt>
      <dd>{{ lineDraft.shape.type === "circle" ? "圆管" : "方管" }}</dd>
      <dt>尺寸</dt>
      <dd>{{ draftShapeText }}</dd>
      <dt>业务</dt>
      <dd>{{ draftBusinessTypeName }}</dd>
      <dt>模型风格</dt>
      <dd>{{ draftModelName }}</dd>
    </dl>

    <dl v-else-if="selectedPoint">
      <dt>类型</dt>
      <dd>管点</dd>
      <dt>ID</dt>
      <dd>{{ selectedPoint.id }}</dd>
      <dt>经度</dt>
      <dd>{{ formatCoordinate(selectedPoint.lon) }}</dd>
      <dt>纬度</dt>
      <dd>{{ formatCoordinate(selectedPoint.lat) }}</dd>
      <dt>高度</dt>
      <dd>{{ formatMeters(selectedPoint.height) }}</dd>
      <dt>近似距地高度</dt>
      <dd>{{ formatMeters(selectedPoint.relativeHeight) }}</dd>
      <dt>埋深</dt>
      <dd>{{ formatMeters(selectedPoint.maishen) }}</dd>
      <dt>图层</dt>
      <dd>{{ selectedPoint.layerId }}</dd>
      <dt>业务</dt>
      <dd>{{ selectedPointBusinessTypeName }}</dd>
    </dl>

    <dl v-else-if="selectedJoint">
      <dt>类型</dt>
      <dd>连接点</dd>
      <dt>ID</dt>
      <dd>{{ selectedJoint.id }}</dd>
      <dt>当前类型</dt>
      <dd>{{ selectedJoint.jointLabel }}</dd>
      <dt>推荐类型</dt>
      <dd>{{ formatJointKindLabel(selectedJoint.recommendedJointKind) }}</dd>
      <dt>手动覆盖</dt>
      <dd>{{ selectedJoint.manualOverride ? "是" : "否" }}</dd>
      <dt>连接数量</dt>
      <dd>{{ selectedJoint.degree }}</dd>
      <dt>关联管线</dt>
      <dd>{{ selectedJoint.branchLineIds.join("、") }}</dd>
      <dt>连接管业务</dt>
      <dd>{{ selectedJointBusinessTypeName }}</dd>
      <dt>连接管模型风格</dt>
      <dd>{{ selectedJointModelName }}</dd>
      <dt>精细模型</dt>
      <dd>{{ jointDetailStatusText }}</dd>
      <dt>模型地址</dt>
      <dd>{{ selectedJoint.detailTilesetUrl ?? "--" }}</dd>
    </dl>

    <dl v-else-if="selectedLine">
      <dt>类型</dt>
      <dd>管线</dd>
      <dt>管线类型</dt>
      <dd>直管</dd>
      <dt>ID</dt>
      <dd>{{ selectedLine.id }}</dd>
      <dt>起点</dt>
      <dd>{{ formatEndpointLabel(selectedLine.start) }}</dd>
      <dt>终点</dt>
      <dd>{{ formatEndpointLabel(selectedLine.end) }}</dd>
      <dt>长度</dt>
      <dd>{{ formatMeters(selectedLine.length) }}</dd>
      <dt>断面</dt>
      <dd>{{ selectedLine.shape.type === "circle" ? "圆管" : "方管" }}</dd>
      <dt>尺寸</dt>
      <dd>{{ shapeText }}</dd>
      <dt>图层</dt>
      <dd>{{ selectedLine.layerId }}</dd>
      <dt>业务</dt>
      <dd>{{ selectedBusinessTypeName }}</dd>
      <dt>模型风格</dt>
      <dd>{{ selectedModelName }}</dd>
      <dt>精细模型</dt>
      <dd>{{ detailStatusText }}</dd>
      <dt>模型地址</dt>
      <dd>{{ selectedLine.detailTilesetUrl ?? "--" }}</dd>
    </dl>

    <form v-if="selectedJoint" class="pipe-info-panel__form" @submit.prevent>
      <label v-if="canEditJointKind">
        <span>连接点类型</span>
        <select v-model="jointKindDraft">
          <option v-for="jointKind in jointKindOptions" :key="jointKind" :value="jointKind">
            {{ formatJointKindLabel(jointKind) }}
          </option>
        </select>
      </label>

      <div class="pipe-info-panel__actions">
        <button v-if="canEditJointKind" type="button" @click="saveJointKind">
          保存并生成接头
        </button>
        <button type="button" @click="regenerateJointModel">
          重新生成接头
        </button>
      </div>
    </form>

    <form v-if="selectedJoint" class="pipe-info-panel__form" @submit.prevent>
      <label>
        <span>连接管业务</span>
        <select v-model="jointBusinessTypeDraft">
          <option
            v-for="businessType in jointBusinessTypeOptions"
            :key="businessType.id"
            :value="businessType.id"
          >
            {{ businessType.name }}
          </option>
        </select>
      </label>

      <label>
        <span>连接管模型风格</span>
        <select v-model="jointModelDraft">
          <option v-for="model in jointModelOptions" :key="model.id" :value="model.id">
            {{ model.name }}
          </option>
        </select>
      </label>

      <div class="pipe-info-panel__actions">
        <button type="button" @click="saveJointModelParams">
          保存外观并生成接头
        </button>
      </div>
    </form>

    <form v-if="canEditLineParams" class="pipe-info-panel__form" @submit.prevent>
      <label>
        <span>外半径(m)</span>
        <input v-model="radiusDraft" type="number" min="0.01" step="0.01" />
      </label>

      <label>
        <span>壁厚(m)</span>
        <input v-model="thicknessDraft" type="number" min="0.001" step="0.001" />
      </label>

      <label>
        <span>业务</span>
        <select v-model="businessTypeDraft">
          <option v-for="businessType in businessTypes" :key="businessType.id" :value="businessType.id">
            {{ businessType.name }}
          </option>
        </select>
      </label>

      <label>
        <span>模型风格</span>
        <select v-model="modelDraft">
          <option v-for="model in filteredModelOptions" :key="model.id" :value="model.id">
            {{ model.name }}
          </option>
        </select>
      </label>

      <p v-if="modelDraftInvalid" class="pipe-info-panel__warning">
        外半径必须大于 0，壁厚必须大于 0 且小于外半径。
      </p>

      <div class="pipe-info-panel__actions">
        <button type="button" :disabled="modelDraftInvalid" @click="saveModelParams">
          {{ isEditingLineDraft ? "应用到待生成管线" : "保存参数" }}
        </button>
        <button
          v-if="selectedLine"
          type="button"
          :disabled="modelDraftInvalid"
          @click="regenerateModel"
        >
          重新生成
        </button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  DEFAULT_PIPE_MODEL_ID,
  getBusinessModelOptions,
  getNormalizedBusinessModelId,
  PIPE_MODEL_OPTIONS,
} from "../../constants/pipelineModelOptions";
import {
  DEFAULT_PIPE_BUSINESS_TYPE_ID,
  normalizePipeBusinessTypeId,
} from "../../constants/pipelineDefaults";
import {
  getPipeJointKindLabel,
  getEditableJointKindsByDegree,
} from "../../constants/pipelineJointOptions";
import type {
  PipeJoint,
  PipeJointKind,
  PipeJointModelUpdate,
  PipeLine,
  PipeLineDraft,
  PipeLineModelUpdate,
  PipeBusinessType,
  PipeModelOption,
  PipePoint,
  PipelineToolMode,
  SelectedPipelineObject,
} from "../../types/pipeline";
import {
  distanceBetweenEndpoints,
  formatCoordinate,
  formatEndpointLabel,
  formatMeters,
} from "../../utils/pipelineGeometry";

const props = defineProps<{
  activeTool: PipelineToolMode;
  selectedObject: SelectedPipelineObject | null;
  lineDraft: PipeLineDraft;
  points: PipePoint[];
  lines: PipeLine[];
  joints: PipeJoint[];
  businessTypes: PipeBusinessType[];
  modelOptions?: PipeModelOption[];
}>();

const emit = defineEmits<{
  (event: "save-line-draft-model", update: PipeLineModelUpdate): void;
  (event: "save-line-model", id: string, update: PipeLineModelUpdate): void;
  (event: "regenerate-line-model", id: string, update: PipeLineModelUpdate): void;
  (event: "save-joint-kind", id: string, jointKind: PipeJointKind): void;
  (event: "save-joint-model", id: string, update: PipeJointModelUpdate): void;
  (event: "regenerate-joint-model", id: string): void;
}>();

const radiusDraft = ref("0.3");
const thicknessDraft = ref("0.02");
const businessTypeDraft = ref(DEFAULT_PIPE_BUSINESS_TYPE_ID);
const modelDraft = ref(DEFAULT_PIPE_MODEL_ID);
const jointKindDraft = ref<PipeJointKind>("straight");
const jointBusinessTypeDraft = ref(DEFAULT_PIPE_BUSINESS_TYPE_ID);
const jointModelDraft = ref(DEFAULT_PIPE_MODEL_ID);

const modelOptions = computed(() => props.modelOptions ?? PIPE_MODEL_OPTIONS);
const filteredModelOptions = computed(() => {
  const allowedIds = new Set(getBusinessModelOptions(businessTypeDraft.value).map((item) => item.id));
  return modelOptions.value.filter((item) => allowedIds.has(item.id));
});
const jointKindOptions = computed(() =>
  selectedJoint.value ? getEditableJointKindsByDegree(selectedJoint.value.degree) : [],
);
const canEditJointKind = computed(() => selectedJoint.value?.degree === 2 && jointKindOptions.value.length > 1);
const jointBusinessTypeOptions = computed(() => {
  const selected = selectedJoint.value;
  if (!selected) {
    return [];
  }

  const allowedIds = new Set(
    selected.branches.map((branch) => normalizePipeBusinessTypeId(branch.businessTypeId)),
  );

  return props.businessTypes.filter((businessType) => allowedIds.has(businessType.id));
});
const jointModelOptions = computed(() => {
  const selected = selectedJoint.value;
  if (!selected) {
    return [];
  }

  const optionById = new Map<string, PipeModelOption>();
  for (const branch of selected.branches) {
    for (const model of getBusinessModelOptions(branch.businessTypeId)) {
      optionById.set(model.id, model);
    }
  }

  return Array.from(optionById.values());
});
const isEditingLineDraft = computed(() => props.activeTool === "add-line");
const canEditLineParams = computed(() => isEditingLineDraft.value || Boolean(selectedLine.value));

const selectedPoint = computed(() => {
  if (props.selectedObject?.type !== "point") {
    return null;
  }

  return props.points.find((point) => point.id === props.selectedObject?.id) ?? null;
});

const selectedLine = computed(() => {
  if (props.selectedObject?.type !== "line") {
    return null;
  }

  return props.lines.find((line) => line.id === props.selectedObject?.id) ?? null;
});

const selectedJoint = computed(() => {
  if (props.selectedObject?.type !== "joint") {
    return null;
  }

  return props.joints.find((joint) => joint.id === props.selectedObject?.id) ?? null;
});

const selectedBusinessTypeName = computed(() => {
  const businessTypeId = normalizePipeBusinessTypeId(selectedLine.value?.businessTypeId);
  const businessType = props.businessTypes.find((item) => item.id === businessTypeId);
  return businessType?.name ?? businessTypeId;
});

const selectedPointBusinessTypeName = computed(() => {
  const businessTypeId = normalizePipeBusinessTypeId(selectedPoint.value?.businessTypeId);
  const businessType = props.businessTypes.find((item) => item.id === businessTypeId);
  return businessType?.name ?? businessTypeId;
});

const selectedModelName = computed(() => {
  const modelId = getNormalizedBusinessModelId(selectedLine.value?.businessTypeId, selectedLine.value?.modelId);
  const model = modelOptions.value.find((item) => item.id === modelId);
  return model?.name ?? modelId;
});

const selectedJointBusinessTypeName = computed(() => {
  const businessTypeId = normalizePipeBusinessTypeId(selectedJoint.value?.businessTypeId);
  const businessType = props.businessTypes.find((item) => item.id === businessTypeId);
  return businessType?.name ?? businessTypeId;
});

const selectedJointModelName = computed(() => {
  const modelId = getNormalizedBusinessModelId(
    selectedJoint.value?.businessTypeId,
    selectedJoint.value?.modelId,
  );
  const model = modelOptions.value.find((item) => item.id === modelId);
  return model?.name ?? modelId;
});

const draftBusinessTypeName = computed(() => {
  const businessTypeId = normalizePipeBusinessTypeId(props.lineDraft.businessTypeId);
  const businessType = props.businessTypes.find((item) => item.id === businessTypeId);
  return businessType?.name ?? businessTypeId;
});

const draftModelName = computed(() => {
  const modelId = getNormalizedBusinessModelId(props.lineDraft.businessTypeId, props.lineDraft.modelId);
  const model = modelOptions.value.find((item) => item.id === modelId);
  return model?.name ?? modelId;
});

const draftLineLengthText = computed(() => {
  if (!props.lineDraft.start || !props.lineDraft.end) {
    return "--";
  }

  return formatMeters(distanceBetweenEndpoints(props.lineDraft.start, props.lineDraft.end));
});

const draftShapeText = computed(() => formatShapeText(props.lineDraft.shape));

const shapeText = computed(() => {
  const shape = selectedLine.value?.shape;
  if (!shape) {
    return "--";
  }

  return formatShapeText(shape);
});

function formatShapeText(shape: PipeLine["shape"]) {
  if (shape.type === "circle") {
    return `半径 ${formatMeters(shape.radius)}，壁厚 ${formatMeters(shape.thickness)}`;
  }

  return `宽 ${formatMeters(shape.width)}，高 ${formatMeters(shape.height)}，壁厚 ${formatMeters(
    shape.thickness,
  )}`;
}

const detailStatusText = computed(() => {
  return formatDetailStatus(selectedLine.value?.detailModelStatus);
});

const jointDetailStatusText = computed(() => formatDetailStatus(selectedJoint.value?.detailModelStatus));

function formatDetailStatus(status?: string) {
  if (status === "generating") {
    return "生成中";
  }

  if (status === "loaded") {
    return "已加载";
  }

  if (status === "dirty") {
    return "参数已修改，需重新生成";
  }

  if (status === "failed") {
    return "生成失败";
  }

  return "未生成";
}

function formatJointKindLabel(jointKind: PipeJointKind) {
  return getPipeJointKindLabel(jointKind);
}

const modelDraftInvalid = computed(() => {
  const radius = Number(radiusDraft.value);
  const thickness = Number(thicknessDraft.value);

  return (
    !Number.isFinite(radius) ||
    !Number.isFinite(thickness) ||
    radius <= 0 ||
    thickness <= 0 ||
    thickness >= radius
  );
});

function syncLineFormFromShape(
  shape: PipeLine["shape"],
  businessTypeId: string | undefined,
  modelId: string | undefined,
) {
  if (shape.type === "circle") {
    radiusDraft.value = String(shape.radius);
    thicknessDraft.value = String(shape.thickness);
  } else {
    radiusDraft.value = String(Math.max(shape.width, shape.height) / 2);
    thicknessDraft.value = String(shape.thickness);
  }

  businessTypeDraft.value = normalizePipeBusinessTypeId(businessTypeId);
  modelDraft.value = getNormalizedBusinessModelId(businessTypeDraft.value, modelId);
}

watch(
  () => ({
    isEditingLineDraft: isEditingLineDraft.value,
    shape: props.lineDraft.shape,
    businessTypeId: props.lineDraft.businessTypeId,
    modelId: props.lineDraft.modelId,
  }),
  ({ isEditingLineDraft: editingDraft, shape, businessTypeId, modelId }) => {
    if (!editingDraft) {
      return;
    }

    syncLineFormFromShape(shape, businessTypeId, modelId);
  },
  { immediate: true },
);

watch(
  [selectedLine, isEditingLineDraft],
  ([line, editingDraft]) => {
    if (!line || editingDraft) {
      return;
    }

    // 面板草稿只跟随当前选中管线初始化；用户修改草稿不会立即改动业务数据。
    syncLineFormFromShape(line.shape, line.businessTypeId, line.modelId);
  },
  { immediate: true },
);

watch(
  businessTypeDraft,
  (businessTypeId) => {
    modelDraft.value = getNormalizedBusinessModelId(businessTypeId, modelDraft.value);
  },
);

watch(
  selectedJoint,
  (joint) => {
    if (!joint) {
      return;
    }

    // 连接点草稿只记录类型选择；真正重建模型交给外层统一的 3D Tiles 生成流程。
    const options = getEditableJointKindsByDegree(joint.degree);
    jointKindDraft.value = options.includes(joint.jointKind) ? joint.jointKind : options[0] ?? joint.jointKind;
    const branchBusinessTypeId = normalizePipeBusinessTypeId(joint.branches[0]?.businessTypeId);
    jointBusinessTypeDraft.value = normalizePipeBusinessTypeId(joint.businessTypeId ?? branchBusinessTypeId);
    jointModelDraft.value = getNormalizedBusinessModelId(jointBusinessTypeDraft.value, joint.modelId);
  },
  { immediate: true },
);

watch(
  jointBusinessTypeDraft,
  (businessTypeId) => {
    jointModelDraft.value = getNormalizedBusinessModelId(businessTypeId, jointModelDraft.value);
  },
);

watch(
  jointModelDraft,
  (modelId) => {
    const selected = selectedJoint.value;
    if (!selected) {
      return;
    }

    if (getBusinessModelOptions(jointBusinessTypeDraft.value).some((model) => model.id === modelId)) {
      return;
    }

    const matchingBusinessType = jointBusinessTypeOptions.value.find((businessType) =>
      getBusinessModelOptions(businessType.id).some((model) => model.id === modelId),
    );

    if (matchingBusinessType) {
      jointBusinessTypeDraft.value = matchingBusinessType.id;
    }
  },
);

function buildModelUpdate(): PipeLineModelUpdate {
  return {
    radius: Number(radiusDraft.value),
    thickness: Number(thicknessDraft.value),
    businessTypeId: businessTypeDraft.value || DEFAULT_PIPE_BUSINESS_TYPE_ID,
    modelId: getNormalizedBusinessModelId(businessTypeDraft.value, modelDraft.value),
  };
}

function saveModelParams() {
  if (modelDraftInvalid.value) {
    return;
  }

  if (isEditingLineDraft.value) {
    emit("save-line-draft-model", buildModelUpdate());
    return;
  }

  if (!selectedLine.value) {
    return;
  }

  // 保存只更新业务参数；如果已有精细模型，则标记为 dirty，等待用户主动重新生成。
  emit("save-line-model", selectedLine.value.id, buildModelUpdate());
}

function regenerateModel() {
  if (!selectedLine.value || modelDraftInvalid.value) {
    return;
  }

  // 重新生成会走 Vite 本地生成接口；成功后再替换旧 3D Tiles，失败时保留旧模型。
  emit("regenerate-line-model", selectedLine.value.id, buildModelUpdate());
}

function saveJointKind() {
  if (!selectedJoint.value || !canEditJointKind.value) {
    return;
  }

  emit("save-joint-kind", selectedJoint.value.id, jointKindDraft.value);
}

function saveJointModelParams() {
  if (!selectedJoint.value) {
    return;
  }

  emit("save-joint-model", selectedJoint.value.id, {
    businessTypeId: jointBusinessTypeDraft.value || DEFAULT_PIPE_BUSINESS_TYPE_ID,
    modelId: getNormalizedBusinessModelId(jointBusinessTypeDraft.value, jointModelDraft.value),
  });
}

function regenerateJointModel() {
  if (!selectedJoint.value) {
    return;
  }

  emit("regenerate-joint-model", selectedJoint.value.id);
}
</script>

<style scoped>
.pipe-info-panel {
  width: 340px;
  max-height: calc(100vh - 150px);
  overflow: auto;
  color: #e8f4fb;
  background: rgba(16, 24, 32, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

header {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

h2 {
  margin: 0;
  font-size: 15px;
}

.pipe-info-panel__empty {
  padding: 18px 14px;
  color: rgba(232, 244, 251, 0.68);
}

dl {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px 10px;
  margin: 0;
  padding: 12px 14px;
}

dt {
  color: rgba(232, 244, 251, 0.68);
}

dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.pipe-info-panel__form {
  display: grid;
  gap: 10px;
  padding: 0 14px 14px;
}

.pipe-info-panel__form label {
  display: grid;
  gap: 5px;
  color: rgba(232, 244, 251, 0.72);
  font-size: 12px;
}

input,
select {
  height: 30px;
  min-width: 0;
  padding: 0 8px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
}

select {
  color-scheme: light;
}

select option {
  color: #10202d;
  background: #ffffff;
}

select option:checked {
  color: #ffffff;
  background: #1d4ed8;
}

.pipe-info-panel__warning {
  margin: 0;
  color: #ffd166;
  font-size: 12px;
  line-height: 1.5;
}

.pipe-info-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  height: 30px;
  padding: 0 10px;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background: rgba(0, 133, 160, 0.68);
  cursor: pointer;
}

button:disabled {
  color: rgba(255, 255, 255, 0.48);
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.08);
}
</style>
