<template>
  <section class="pipe-panel">
    <header class="pipe-panel__header">
      <h2>管点管理</h2>
      <span>{{ points.length }} 个</span>
    </header>

    <div v-if="points.length === 0" class="pipe-panel__empty">暂无管点</div>

    <div v-else class="pipe-panel__list">
      <article v-for="point in points" :key="point.id" class="pipe-panel__row">
        <div>
          <strong>{{ point.id }}</strong>
          <small>{{ formatCoordinate(point.lon) }}, {{ formatCoordinate(point.lat) }}</small>
          <small>近似距地高度 {{ formatMeters(point.relativeHeight) }}</small>
        </div>
        <div class="pipe-panel__actions">
          <button type="button" @click="$emit('select', point.id)">查看</button>
          <button type="button" @click="$emit('fly-to', point.id)">定位</button>
          <button type="button" @click="$emit('delete', point.id)">删除</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PipePoint } from "../../types/pipeline";
import { formatCoordinate, formatMeters } from "../../utils/pipelineGeometry";

defineProps<{
  points: PipePoint[];
}>();

defineEmits<{
  (event: "select", id: string): void;
  (event: "fly-to", id: string): void;
  (event: "delete", id: string): void;
}>();
</script>

<style scoped>
.pipe-panel {
  width: 330px;
  max-height: calc(100vh - 160px);
  overflow: hidden;
  color: #e8f4fb;
  background: rgba(16, 24, 32, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.pipe-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

h2 {
  margin: 0;
  font-size: 15px;
}

.pipe-panel__empty {
  padding: 18px 14px;
  color: rgba(232, 244, 251, 0.68);
}

.pipe-panel__list {
  display: grid;
  gap: 8px;
  max-height: calc(100vh - 220px);
  overflow: auto;
  padding: 10px;
}

.pipe-panel__row {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
}

.pipe-panel__row div:first-child {
  display: grid;
  gap: 4px;
}

small {
  color: rgba(232, 244, 251, 0.72);
}

.pipe-panel__actions {
  display: flex;
  gap: 8px;
}

button {
  height: 28px;
  padding: 0 10px;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background: rgba(0, 133, 160, 0.68);
  cursor: pointer;
}
</style>
