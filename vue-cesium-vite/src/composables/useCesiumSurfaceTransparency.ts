import { readonly, ref } from "vue";
import { Color, type Viewer } from "cesium";

const MIN_SURFACE_OPACITY = 0.15;
const MAX_SURFACE_OPACITY = 1;
const HIDDEN_BACK_FACE_ALPHA = 0;

function clampOpacity(value: number) {
  return Math.min(Math.max(value, MIN_SURFACE_OPACITY), MAX_SURFACE_OPACITY);
}

export function useCesiumSurfaceTransparency(viewer: Viewer) {
  const globe = viewer.scene.globe;
  const opacity = ref(MAX_SURFACE_OPACITY);
  const originalTranslucency = {
    enabled: globe.translucency.enabled,
    frontFaceAlpha: globe.translucency.frontFaceAlpha,
    backFaceAlpha: globe.translucency.backFaceAlpha,
  };
  const originalGlobeRendering = {
    depthTestAgainstTerrain: globe.depthTestAgainstTerrain,
    undergroundColor: Color.clone(globe.undergroundColor),
  };

  function restoreGlobeRendering() {
    globe.depthTestAgainstTerrain = originalGlobeRendering.depthTestAgainstTerrain;
    globe.undergroundColor = Color.clone(originalGlobeRendering.undergroundColor);
  }

  function applyOpacity(nextOpacity: number) {
    const safeOpacity = clampOpacity(nextOpacity);
    opacity.value = safeOpacity;

    const isTranslucent = safeOpacity < MAX_SURFACE_OPACITY;

    // Cesium globe translucency 只负责地表透明，不改变管线 entity 或 3D Tiles 材质。
    // 地下管网只需要前表面半透明；背面必须隐藏，否则缩放/倾斜时会透出地球背面的影像块。
    globe.translucency.frontFaceAlpha = safeOpacity;
    globe.translucency.backFaceAlpha = isTranslucent ? HIDDEN_BACK_FACE_ALPHA : MAX_SURFACE_OPACITY;
    globe.translucency.enabled = isTranslucent;
    if (isTranslucent) {
      globe.depthTestAgainstTerrain = false;
      globe.undergroundColor = Color.TRANSPARENT;
    } else {
      restoreGlobeRendering();
    }
    viewer.scene.requestRender();
  }

  function reset() {
    applyOpacity(MAX_SURFACE_OPACITY);
  }

  function destroy() {
    // 组件卸载时恢复进入管网编辑器前的地表透明状态，避免影响其他 Cesium 页面。
    globe.translucency.enabled = originalTranslucency.enabled;
    globe.translucency.frontFaceAlpha = originalTranslucency.frontFaceAlpha;
    globe.translucency.backFaceAlpha = originalTranslucency.backFaceAlpha;
    restoreGlobeRendering();
    viewer.scene.requestRender();
  }

  return {
    opacity: readonly(opacity),
    setOpacity: applyOpacity,
    reset,
    destroy,
  };
}

export type CesiumSurfaceTransparency = ReturnType<typeof useCesiumSurfaceTransparency>;
