<template>
  <div class="cesium-viewer">
    <div ref="cesiumContainer" class="cesium-viewer__container"></div>
    <PipelineEditor v-if="viewerRef" :viewer="viewerRef" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import {
  ImageryLayer,
  Viewer,
  WebMapTileServiceImageryProvider,
} from "cesium";
import PipelineEditor from "./pipeline/PipelineEditor.vue";
import { flyToBeijingInitialView } from "../utils/cesiumInitialCamera";

const tiandituToken = import.meta.env.VITE_TIANDITU_TOKEN;
const tiandituSubdomains = ["0", "1", "2", "3", "4", "5", "6", "7"];

const cesiumContainer = ref<HTMLElement | null>(null);
const viewerRef = shallowRef<Viewer | null>(null);

function createTiandituProvider(layer: string) {
  return new WebMapTileServiceImageryProvider({
    url: `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?tk=${tiandituToken}`,
    layer,
    style: "default",
    format: "tiles",
    tileMatrixSetID: "w",
    subdomains: tiandituSubdomains,
    maximumLevel: 18,
    credit: "天地图",
  });
}

onMounted(() => {
  if (!cesiumContainer.value) {
    return;
  }

  // 创建天地图影像底图
  const tiandituImageLayer = new ImageryLayer(createTiandituProvider("img"));

  const viewer = new Viewer(cesiumContainer.value, {
    baseLayer: tiandituImageLayer,
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    timeline: false,
    navigationHelpButton: false,
  });

  // 添加天地图中文注记层
  viewer.imageryLayers.addImageryProvider(createTiandituProvider("cia"));
  flyToBeijingInitialView(viewer);
  viewerRef.value = viewer;
});

onUnmounted(() => {
  const viewer = viewerRef.value;
  if (viewer) {
    viewer.destroy();
    viewerRef.value = null;
  }
});
</script>

<style>
.cesium-viewer,
.cesium-viewer__container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.cesium-widget-credits {
  display: none !important;
}
</style>
