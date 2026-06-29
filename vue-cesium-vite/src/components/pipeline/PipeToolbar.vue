<template>
  <div class="pipe-toolbar">
    <button
      v-for="item in tools"
      :key="item.mode"
      class="pipe-toolbar__button"
      :class="{ 'pipe-toolbar__button--active': activeTool === item.mode }"
      type="button"
      @click="$emit('select-tool', item.mode)"
    >
      {{ item.label }}
    </button>

    <button
      class="pipe-toolbar__button"
      :class="{ 'pipe-toolbar__button--muted': !showPipePoints }"
      type="button"
      @click="$emit('toggle-points-visible', !showPipePoints)"
    >
      {{ showPipePoints ? "隐藏管点" : "显示管点" }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { PipelineToolMode } from "../../types/pipeline";

defineProps<{
  activeTool: PipelineToolMode;
  showPipePoints: boolean;
}>();

defineEmits<{
  (event: "select-tool", tool: PipelineToolMode): void;
  (event: "toggle-points-visible", visible: boolean): void;
}>();

const tools: Array<{ label: string; mode: PipelineToolMode }> = [
  { label: "添加管点", mode: "add-point" },
  { label: "添加直管", mode: "add-line" },
  { label: "管点管理", mode: "point-manager" },
  { label: "管线管理", mode: "line-manager" },
  { label: "业务类型", mode: "material" },
  { label: "数据导入", mode: "import" },
  { label: "管道信息", mode: "info" },
];
</script>

<style scoped>
.pipe-toolbar {
  display: flex;
  gap: 8px;
  padding: 10px;
  background: rgba(16, 24, 32, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.pipe-toolbar__button {
  height: 34px;
  padding: 0 12px;
  color: #d7e8f5;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.pipe-toolbar__button:hover,
.pipe-toolbar__button--active {
  color: #ffffff;
  border-color: rgba(0, 212, 255, 0.75);
  background: rgba(0, 133, 160, 0.62);
}

.pipe-toolbar__button--muted {
  color: #9dafbd;
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}
</style>
