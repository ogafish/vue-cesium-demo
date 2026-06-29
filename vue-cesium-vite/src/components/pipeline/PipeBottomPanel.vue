<template>
  <div v-if="showPanel" class="pipe-bottom-panel">
    <template v-if="activeTool === 'add-point'">
      <div class="pipe-bottom-panel__group">
        <span>经度：{{ formatCoordinate(pointDraft?.lon) }}</span>
        <span>纬度：{{ formatCoordinate(pointDraft?.lat) }}</span>
        <span>高度：{{ formatMeters(pointDraft?.height) }}</span>
        <span>近似距地高度：{{ formatMeters(pointDraft?.relativeHeight) }}</span>
      </div>
      <div class="pipe-bottom-panel__actions">
        <button type="button" @click="$emit('cancel')">取消选点</button>
        <button type="button" :disabled="!pointDraft" @click="$emit('confirm-point')">
          确定选点
        </button>
      </div>
    </template>

    <template v-else-if="activeTool === 'add-line'">
      <div class="pipe-bottom-panel__endpoint">
        <strong>起点</strong>
        <span>{{ formatEndpointLabel(lineDraft.start) }}</span>
        <button type="button" :disabled="!lineDraft.start" @click="$emit('clear-endpoint', 'start')">
          清除
        </button>
      </div>
      <div class="pipe-bottom-panel__endpoint">
        <strong>终点</strong>
        <span>{{ formatEndpointLabel(lineDraft.end) }}</span>
        <button type="button" :disabled="!lineDraft.end" @click="$emit('clear-endpoint', 'end')">
          清除
        </button>
      </div>
      <div class="pipe-bottom-panel__actions">
        <button type="button" @click="$emit('cancel')">取消</button>
        <button type="button" @click="$emit('confirm-line')">确定生成</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PipeLineDraft, PipePointDraft, PipelineToolMode } from "../../types/pipeline";
import { formatCoordinate, formatEndpointLabel, formatMeters } from "../../utils/pipelineGeometry";

const props = defineProps<{
  activeTool: PipelineToolMode;
  pointDraft: PipePointDraft | null;
  lineDraft: PipeLineDraft;
}>();

defineEmits<{
  (event: "cancel"): void;
  (event: "confirm-point"): void;
  (event: "confirm-line"): void;
  (event: "clear-endpoint", role: "start" | "end"): void;
}>();

const showPanel = computed(() => {
  return props.activeTool === "add-point" || props.activeTool === "add-line";
});
</script>

<style scoped>
.pipe-bottom-panel {
  position: absolute;
  right: 24px;
  bottom: 24px;
  left: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding: 12px 14px;
  color: #e8f4fb;
  background: rgba(16, 24, 32, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.pipe-bottom-panel__group,
.pipe-bottom-panel__endpoint,
.pipe-bottom-panel__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.pipe-bottom-panel__endpoint {
  flex: 1;
}

.pipe-bottom-panel__endpoint span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button {
  height: 32px;
  padding: 0 12px;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  background: rgba(0, 133, 160, 0.72);
  cursor: pointer;
}

button:disabled {
  color: rgba(255, 255, 255, 0.48);
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.08);
}
</style>
