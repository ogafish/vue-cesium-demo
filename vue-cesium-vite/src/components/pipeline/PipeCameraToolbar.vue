<template>
  <div class="pipe-camera-toolbar">
    <button
      v-for="item in views"
      :key="item.mode"
      type="button"
      class="pipe-camera-toolbar__button"
      :title="item.title"
      @click="$emit('change-view', item.mode)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { CameraViewMode } from "../../composables/useCesiumCameraControls";

defineEmits<{
  (event: "change-view", mode: CameraViewMode): void;
}>();

const views: Array<{ label: string; title: string; mode: CameraViewMode }> = [
  { label: "俯视", title: "切换到正上方俯视", mode: "top" },
  { label: "45°", title: "切换到 45 度斜视", mode: "oblique" },
  { label: "低角度", title: "切换到贴近地面的低角度观察", mode: "low" },
  { label: "选中", title: "飞到当前选中的管点或管线", mode: "selected" },
  { label: "初始", title: "回到初始相机位置", mode: "home" },
];
</script>

<style scoped>
.pipe-camera-toolbar {
  display: flex;
  gap: 6px;
  padding: 8px;
  background: rgba(16, 24, 32, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.pipe-camera-toolbar__button {
  height: 30px;
  min-width: 54px;
  padding: 0 10px;
  color: #d7e8f5;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.pipe-camera-toolbar__button:hover {
  color: #ffffff;
  border-color: rgba(0, 212, 255, 0.75);
  background: rgba(0, 133, 160, 0.62);
}
</style>
