<template>
  <section class="pipe-material-panel">
    <header>
      <h2>业务类型</h2>
    </header>
    <div class="pipe-material-panel__list">
      <div
        v-for="businessType in businessTypes"
        :key="businessType.id"
        class="pipe-material-panel__row"
      >
        <span
          class="pipe-material-panel__swatch"
          :style="{ backgroundColor: businessType.color }"
        ></span>
        <span>{{ businessType.name }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PipeBusinessType } from "../../types/pipeline";

defineProps<{
  businessTypes: PipeBusinessType[];
}>();
</script>

<style scoped>
.pipe-material-panel {
  width: 260px;
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

.pipe-material-panel__list {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
}

.pipe-material-panel__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pipe-material-panel__swatch {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 3px;
}
</style>
