import {
  BoundingSphere,
  HeadingPitchRange,
  Math as CesiumMath,
  Viewer,
} from "cesium";
import type { PipelineStore } from "./usePipelineStore";
import { endpointToCartesian, pointToCartesian } from "../utils/pipelineGeometry";
import { flyToBeijingInitialView } from "../utils/cesiumInitialCamera";

export type CameraViewMode = "top" | "oblique" | "low" | "selected" | "home";

export function useCesiumCameraControls(viewer: Viewer, store: PipelineStore) {
  function flyToView(mode: CameraViewMode) {
    // 视角切换优先围绕当前选中管点/管线，没有选中时围绕屏幕中心附近位置。
    if (mode === "home") {
      flyToBeijingInitialView(viewer, 0.8);
      return;
    }

    const sphere = getTargetSphere();

    if (mode === "top") {
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 0.7,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90), sphere.radius * 3),
      });
      return;
    }

    if (mode === "low") {
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 0.7,
        offset: new HeadingPitchRange(
          CesiumMath.toRadians(35),
          CesiumMath.toRadians(-15),
          sphere.radius * 3.2,
        ),
      });
      return;
    }

    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 0.7,
      offset: new HeadingPitchRange(
        CesiumMath.toRadians(45),
        CesiumMath.toRadians(-45),
        sphere.radius * 2.8,
      ),
    });
  }

  function getTargetSphere() {
    // 选中对象决定相机飞行目标，让视角工具服务于当前编辑对象。
    const selected = store.state.selectedObject;

    if (selected?.type === "point") {
      const point = store.getPointById(selected.id);
      if (point) {
        return new BoundingSphere(pointToCartesian(point), 80);
      }
    }

    if (selected?.type === "line") {
      const line = store.getLineById(selected.id);
      if (line) {
        return BoundingSphere.fromPoints([
          endpointToCartesian(line.start),
          endpointToCartesian(line.end),
        ]);
      }
    }

    const fallbackCenter =
      viewer.camera.pickEllipsoid(
        {
          x: viewer.scene.canvas.clientWidth / 2,
          y: viewer.scene.canvas.clientHeight / 2,
        },
        viewer.scene.globe.ellipsoid,
      ) ?? viewer.camera.positionWC;

    return new BoundingSphere(fallbackCenter, 500);
  }

  return {
    flyToView,
  };
}
