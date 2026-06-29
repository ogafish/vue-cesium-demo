<template>
  <section class="pipe-panel">
    <header class="pipe-panel__header">
      <h2>管线管理</h2>
      <span>{{ lines.length }} 条</span>
    </header>

    <div v-if="lines.length === 0" class="pipe-panel__empty">暂无管线</div>

    <div v-else class="pipe-panel__list">
      <article v-for="line in lines" :key="line.id" class="pipe-panel__row">
        <div>
          <strong>{{ line.id }}</strong>
          <!-- 弯管独立管线暂时停用，列表统一展示为直管。 -->
          <small>直管</small>
          <small>{{ formatEndpointLabel(line.start) }} → {{ formatEndpointLabel(line.end) }}</small>
          <small>长度 {{ formatMeters(line.length) }}</small>
        </div>
        <div class="pipe-panel__actions">
          <button type="button" @click="$emit('select', line.id)">查看</button>
          <button type="button" @click="$emit('fly-to', line.id)">定位</button>
          <button
            type="button"
            :disabled="line.detailModelStatus === 'generating'"
            @click="$emit('regenerate', line.id)"
          >
            重新生成
          </button>
          <button type="button" @click="$emit('delete', line.id)">删除</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PipeLine } from "../../types/pipeline";
import { formatEndpointLabel, formatMeters } from "../../utils/pipelineGeometry";

defineProps<{
  lines: PipeLine[];
}>();

defineEmits<{
  (event: "select", id: string): void;
  (event: "fly-to", id: string): void;
  (event: "regenerate", id: string): void;
  (event: "delete", id: string): void;
}>();
</script>

<style scoped>
.pipe-panel {
  width: 360px;
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
  flex-wrap: wrap;
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

button:disabled {
  color: rgba(255, 255, 255, 0.48);
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.08);
}
</style>
