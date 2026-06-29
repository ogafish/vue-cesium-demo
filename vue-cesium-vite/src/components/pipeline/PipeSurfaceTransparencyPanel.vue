<template>
  <section class="pipe-surface-transparency" aria-label="地表透明度">
    <div class="pipe-surface-transparency__header">
      <span>地表透明</span>
      <strong>{{ transparencyPercent }}%</strong>
    </div>

    <input
      class="pipe-surface-transparency__slider"
      type="range"
      min="0"
      max="85"
      step="1"
      :value="transparencyPercent"
      aria-label="调整地表透明度"
      @input="handleInput"
    />

    <div class="pipe-surface-transparency__footer">
      <span>不透明</span>
      <button type="button" @click="$emit('reset')">重置</button>
      <span>透明</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  opacity: number;
}>();

const emit = defineEmits<{
  (event: "update:opacity", opacity: number): void;
  (event: "reset"): void;
}>();

const transparencyPercent = computed(() => {
  // UI 展示的是“透明度”，Cesium 接收的是“不透明度”，两者需要反向换算。
  return Math.round((1 - props.opacity) * 100);
});

function handleInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const transparency = Number(input.value) / 100;

  emit("update:opacity", 1 - transparency);
}
</script>

<style scoped>
.pipe-surface-transparency {
  width: 220px;
  padding: 10px 12px;
  color: #d7e8f5;
  background: rgba(16, 24, 32, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.pipe-surface-transparency__header,
.pipe-surface-transparency__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.pipe-surface-transparency__header strong {
  color: #7fffd4;
  font-size: 13px;
}

.pipe-surface-transparency__slider {
  width: 100%;
  margin: 8px 0 6px;
  accent-color: #00d4ff;
}

.pipe-surface-transparency__footer {
  color: rgba(215, 232, 245, 0.72);
  font-size: 11px;
}

.pipe-surface-transparency__footer button {
  height: 24px;
  padding: 0 8px;
  color: #d7e8f5;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.pipe-surface-transparency__footer button:hover {
  color: #ffffff;
  border-color: rgba(0, 212, 255, 0.75);
  background: rgba(0, 133, 160, 0.62);
}
</style>
