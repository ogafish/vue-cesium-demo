import {
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  Matrix4,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import type { PipelineStore } from "./usePipelineStore";

const ORBIT_RADIANS_PER_SECOND = CesiumMath.toRadians(18);
const MIN_ORBIT_RANGE_METERS = 40;
const MAX_ORBIT_PITCH = CesiumMath.toRadians(-8);

type OrbitState = {
  center: Cartesian3;
  heading: number;
  pitch: number;
  range: number;
  lastTime: number;
};

export function useCesiumCameraOrbit(viewer: Viewer, store: PipelineStore) {
  // 单独使用一个 ScreenSpaceEventHandler，避免把相机环绕逻辑塞进管线拾取/拖拽交互层。
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const defaultDoubleClickAction = viewer.screenSpaceEventHandler.getInputAction(
    ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  );
  let orbitState: OrbitState | null = null;

  // Cesium 默认左键双击会触发缩放，这里由环绕观察接管，避免双击后相机同时缩放和环绕。
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  function pickOrbitCenter(position: Cartesian2) {
    let center: Cartesian3 | undefined;

    if (viewer.scene.pickPositionSupported) {
      // 优先拾取模型/3D Tiles/地形表面，这样可以围绕用户真正点到的管线或地表位置旋转。
      center = viewer.scene.pickPosition(position);
    }

    if (!center) {
      center = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    }

    return center ?? null;
  }

  function makeInitialOrbitState(center: Cartesian3): OrbitState {
    const range = Math.max(
      Cartesian3.distance(viewer.camera.positionWC, center),
      MIN_ORBIT_RANGE_METERS,
    );
    const pitch = Math.min(viewer.camera.pitch, MAX_ORBIT_PITCH);

    return {
      center: Cartesian3.clone(center),
      heading: viewer.camera.heading,
      pitch,
      range,
      lastTime: performance.now(),
    };
  }

  function startOrbit(position: Cartesian2) {
    const center = pickOrbitCenter(position);

    if (!center) {
      store.setMessage("未获取到旋转中心");
      return;
    }

    orbitState = makeInitialOrbitState(center);
    store.setMessage("已开启环绕观察，下一次鼠标操作会停止");
  }

  function stopOrbit() {
    if (!orbitState) {
      return;
    }

    orbitState = null;
    // 结束 lookAt 约束后恢复普通世界坐标相机控制，否则后续拖拽会继续以旧中心为参考。
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    store.setMessage("已停止环绕观察");
  }

  function updateOrbit() {
    if (!orbitState) {
      return;
    }

    const now = performance.now();
    const deltaSeconds = Math.max((now - orbitState.lastTime) / 1000, 0);
    orbitState.lastTime = now;
    orbitState.heading += ORBIT_RADIANS_PER_SECOND * deltaSeconds;

    // 只改变 heading，保持当前距离和俯仰角，实现围绕点位的水平截面环绕观察。
    viewer.camera.lookAt(
      orbitState.center,
      new HeadingPitchRange(orbitState.heading, orbitState.pitch, orbitState.range),
    );
  }

  handler.setInputAction((event: { position: Cartesian2 }) => {
    startOrbit(event.position);
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  handler.setInputAction(() => {
    stopOrbit();
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction(() => {
    stopOrbit();
  }, ScreenSpaceEventType.RIGHT_DOWN);

  handler.setInputAction(() => {
    stopOrbit();
  }, ScreenSpaceEventType.MIDDLE_DOWN);

  handler.setInputAction(() => {
    stopOrbit();
  }, ScreenSpaceEventType.WHEEL);

  viewer.clock.onTick.addEventListener(updateOrbit);

  function destroy() {
    stopOrbit();
    viewer.clock.onTick.removeEventListener(updateOrbit);
    handler.destroy();

    if (defaultDoubleClickAction) {
      viewer.screenSpaceEventHandler.setInputAction(
        defaultDoubleClickAction,
        ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );
    }
  }

  return {
    stopOrbit,
    destroy,
  };
}

export type CesiumCameraOrbit = ReturnType<typeof useCesiumCameraOrbit>;
