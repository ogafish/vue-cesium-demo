import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import type { PipelineStore } from "./usePipelineStore";
import type { PipeEndpoint, PipePointDraft } from "../types/pipeline";
import { PIPELINE_ENDPOINT_SNAP_PIXELS } from "../constants/pipelineDefaults";
import {
  cartesianToLonLatHeight,
  createFreeEndpoint,
  createEndpointFromLine,
  createEndpointFromPoint,
  getEnuAxisDirection,
} from "../utils/pipelineGeometry";
import { validatePipePointPick } from "../utils/pipelineValidation";

type DragState = {
  axis: "x" | "y" | "z";
  startMouse: Cartesian2;
  startCartesian: Cartesian3;
  startScreen: Cartesian2;
  axisScreenDirection: Cartesian2;
  metersPerPixel: number;
};

type PickedPipelineEntity = {
  pipelineType?: string;
  pointId?: string;
  lineId?: string;
  connectionNodeId?: string;
  jointId?: string;
  endpointRole?: "start" | "end";
  axis?: "x" | "y" | "z";
};

export function useCesiumPipelineInteraction(
  viewer: Viewer,
  store: PipelineStore,
  getLineIdFromPickedObject?: (picked: unknown) => string | null,
  getJointIdFromPickedObject?: (picked: unknown) => string | null,
) {
  // 所有 Cesium 鼠标事件集中在这里注册，组件卸载时统一销毁。
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  let dragState: DragState | null = null;

  function pickPosition(position: Cartesian2) {
    let cartesian: Cartesian3 | undefined;

    if (viewer.scene.pickPositionSupported) {
      // 优先使用深度拾取，能命中地形、模型或 3D 对象表面。
      cartesian = viewer.scene.pickPosition(position);
    }

    if (!cartesian) {
      cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    }

    return cartesian ?? null;
  }

  function getGroundHeight(cartesian: Cartesian3) {
    const cartographic = Cartographic.fromCartesian(cartesian);
    const height = viewer.scene.globe.getHeight(cartographic);

    // 无地形或地形未加载时 getHeight 可能为空；第一版用 0 作为近似地面高度。
    return typeof height === "number" && Number.isFinite(height) ? height : 0;
  }

  function makeDraftFromCartesian(cartesian: Cartesian3): PipePointDraft {
    const coordinate = cartesianToLonLatHeight(cartesian);
    const groundHeight = getGroundHeight(cartesian);

    return {
      cartesian,
      lon: coordinate.lon,
      lat: coordinate.lat,
      height: coordinate.height,
      groundHeight,
      relativeHeight: coordinate.height - groundHeight,
    };
  }

  function getPickedPipelineEntity(position: Cartesian2, picked = viewer.scene.pick(position)) {
    const entity = picked?.id as PickedPipelineEntity | undefined;

    return entity ?? null;
  }

  function handleLeftClick(position: Cartesian2) {
    // 根据当前工具模式分发点击行为：选点、选端点或普通对象选择。
    if (dragState) {
      return;
    }

    if (store.state.activeTool === "add-point") {
      handlePointPick(position);
      return;
    }

    if (store.state.activeTool === "add-line") {
      handleLineEndpointPick(position);
      return;
    }

    handleObjectPick(position);
  }

  function handlePointPick(position: Cartesian2) {
    const cartesian = pickPosition(position);

    if (!cartesian) {
      store.setMessage("未能获取选点位置");
      return;
    }

    const draft = makeDraftFromCartesian(cartesian);
    const validation = validatePipePointPick(draft.relativeHeight);

    if (!validation.ok) {
      store.setMessage(validation.message);
      return;
    }

    store.setPointDraft(draft);
    store.setMessage("已选择临时管点，可拖动三轴微调");
  }

  function handleLineEndpointPick(position: Cartesian2) {
    const endpoint = pickEndpoint(position);
    // 弯管独立创建流程暂时停用：不再拾取自由弯折控制点。
    // const endpoint = shouldPickFreeBendControl()
    //   ? pickEndpoint(position) ?? pickFreeBendControl(position)
    //   : pickEndpoint(position);

    if (!endpoint) {
      store.setMessage("请选择已有管点或管线端点");
      return;
    }

    store.selectLineEndpoint(endpoint);
  }

  // 弯管自由控制点拾取暂时停用；后续弯曲段由连接头内部模型处理。
  // function shouldPickFreeBendControl() { ... }
  // function pickFreeBendControl(position: Cartesian2): PipeEndpoint | null { ... }

  function handleObjectPick(position: Cartesian2) {
    const rawPicked = viewer.scene.pick(position);
    const picked = getPickedPipelineEntity(position, rawPicked);

    if (picked?.pipelineType === "point" && picked.pointId) {
      store.selectObject({ type: "point", id: picked.pointId });
      return;
    }

    if (picked?.pipelineType === "line" && picked.lineId) {
      store.selectObject({ type: "line", id: picked.lineId });
      return;
    }

    if (picked?.pipelineType === "connection-joint" && (picked.jointId || picked.connectionNodeId)) {
      const joint = picked.jointId ? store.getJointById(picked.jointId) : null;
      const node = picked.connectionNodeId ? store.getConnectionNodeById(picked.connectionNodeId) : null;

      if (joint) {
        // 接头已经是正式业务对象时直接选中接头，后续信息面板可编辑连接类型。
        store.selectJoint(joint.id);
        return;
      }

      if (node) {
        const firstBranch = node.branches[0];
        // 只有还没有正式 joint 的占位节点才退回选中关联管线，避免点击空接头清空状态。
        store.selectObject({ type: "line", id: firstBranch.lineId });
        store.setMessage(
          `${node.jointLabel}，连接 ${node.degree} 条管线`,
        );
        return;
      }
    }

    const pickedJointId = getJointIdFromPickedObject?.(rawPicked);
    const pickedJoint = pickedJointId ? store.getJointById(pickedJointId) : null;

    if (pickedJoint) {
      // 精细接头 3D Tiles 被拾取后同样回写真实业务状态，避免只产生视觉反馈。
      store.selectJoint(pickedJoint.id);
      return;
    }

    const pickedLineId = getLineIdFromPickedObject?.(rawPicked);
    const pickedLine = pickedLineId ? store.getLineById(pickedLineId) : null;

    if (pickedLine) {
      // 精细 3D Tiles 被拾取后必须反查到真实业务管线，避免只产生视觉反馈、不影响 store 的假选中。
      store.selectObject({ type: "line", id: pickedLine.id });
      return;
    }

    store.selectObject(null);
  }

  function pickEndpoint(position: Cartesian2): PipeEndpoint | null {
    // 先取直接命中的 entity；没命中时再做屏幕距离吸附。
    const direct = getPickedPipelineEntity(position);
    const directEndpoint = endpointFromPickedEntity(direct);

    if (directEndpoint) {
      return directEndpoint;
    }

    return findNearestEndpoint(position);
  }

  function endpointFromPickedEntity(entity: PickedPipelineEntity | null): PipeEndpoint | null {
    if (!entity) {
      return null;
    }

    if (entity.pipelineType === "point" && entity.pointId) {
      const point = store.getPointById(entity.pointId);
      return point ? createEndpointFromPoint(point) : null;
    }

    if (
      entity.pipelineType === "line-endpoint" &&
      entity.lineId &&
      entity.endpointRole
    ) {
      const line = store.getLineById(entity.lineId);
      return line ? createEndpointFromLine(line, entity.endpointRole) : null;
    }

    return null;
  }

  function findNearestEndpoint(position: Cartesian2): PipeEndpoint | null {
    // 屏幕像素吸附比空间距离更符合用户点击体验。
    let nearest: { endpoint: PipeEndpoint; distance: number } | null = null;

    for (const point of store.state.points) {
      const endpoint = createEndpointFromPoint(point);
      measureEndpointDistance(endpoint, position, (distance) => {
        if (!nearest || distance < nearest.distance) {
          nearest = { endpoint, distance };
        }
      });
    }

    for (const line of store.state.lines) {
      for (const role of ["start", "end"] as const) {
        const endpoint = createEndpointFromLine(line, role);
        measureEndpointDistance(endpoint, position, (distance) => {
          if (!nearest || distance < nearest.distance) {
            nearest = { endpoint, distance };
          }
        });
      }
    }

    return nearest && nearest.distance <= PIPELINE_ENDPOINT_SNAP_PIXELS
      ? nearest.endpoint
      : null;
  }

  function measureEndpointDistance(
    endpoint: PipeEndpoint,
    mousePosition: Cartesian2,
    callback: (distance: number) => void,
  ) {
    const cartesian = Cartesian3.fromDegrees(endpoint.lon, endpoint.lat, endpoint.height);
    const screen = SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);

    if (!screen) {
      return;
    }

    callback(Cartesian2.distance(screen, mousePosition));
  }

  function handleLeftDown(position: Cartesian2) {
    if (!store.state.pointDraft) {
      return;
    }

    // 只有按下三轴 entity 才进入拖拽状态，避免和普通地图拖拽冲突。
    const picked = getPickedPipelineEntity(position);
    if (picked?.pipelineType !== "axis" || !picked.axis) {
      return;
    }

    const startCartesian = store.state.pointDraft.cartesian;
    const direction = getEnuAxisDirection(startCartesian, picked.axis);
    const axisEnd = Cartesian3.add(
      startCartesian,
      Cartesian3.multiplyByScalar(direction, 1, new Cartesian3()),
      new Cartesian3(),
    );
    const startScreen = SceneTransforms.worldToWindowCoordinates(viewer.scene, startCartesian);
    const endScreen = SceneTransforms.worldToWindowCoordinates(viewer.scene, axisEnd);

    if (!startScreen || !endScreen) {
      store.setMessage("当前视角下无法拖动该坐标轴");
      return;
    }

    const axisScreenDirection = Cartesian2.subtract(endScreen, startScreen, new Cartesian2());
    if (Cartesian2.magnitude(axisScreenDirection) < 0.0001) {
      store.setMessage("当前视角下坐标轴方向不稳定，请调整视角后再拖动");
      return;
    }

    Cartesian2.normalize(axisScreenDirection, axisScreenDirection);

    dragState = {
      axis: picked.axis,
      startMouse: Cartesian2.clone(position),
      startCartesian: Cartesian3.clone(startCartesian),
      startScreen,
      axisScreenDirection,
      metersPerPixel: computeMetersPerPixel(startCartesian),
    };

    // 拖拽坐标轴时暂时禁用相机交互，防止移动管点时地图同时旋转。
    setCameraInteraction(false);
  }

  function handleMouseMove(position: Cartesian2) {
    if (!dragState) {
      return;
    }

    const mouseDelta = Cartesian2.subtract(position, dragState.startMouse, new Cartesian2());
    // 将鼠标位移投影到当前轴的屏幕方向，只允许沿一个 ENU 轴移动。
    const signedPixels = Cartesian2.dot(mouseDelta, dragState.axisScreenDirection);
    const signedMeters = signedPixels * dragState.metersPerPixel;
    const axisDirection = getEnuAxisDirection(dragState.startCartesian, dragState.axis);
    const nextCartesian = Cartesian3.add(
      dragState.startCartesian,
      Cartesian3.multiplyByScalar(axisDirection, signedMeters, new Cartesian3()),
      new Cartesian3(),
    );
    const draft = makeDraftFromCartesian(nextCartesian);

    store.updatePointDraft(draft);
  }

  function handleLeftUp() {
    if (!dragState) {
      return;
    }

    dragState = null;
    setCameraInteraction(true);
  }

  function computeMetersPerPixel(center: Cartesian3) {
    // 第一版用视距和相机 FOV 估算像素到米的比例，后续可升级为射线和平面求交。
    const distance = Cartesian3.distance(viewer.camera.positionWC, center);
    const fov = "frustum" in viewer.camera && "fovy" in viewer.camera.frustum
      ? viewer.camera.frustum.fovy
      : CesiumMath.toRadians(60);
    const canvasHeight = viewer.scene.canvas.clientHeight || 1;
    const metersPerPixel = (2 * distance * Math.tan(fov / 2)) / canvasHeight;

    return Math.max(metersPerPixel, 0.01);
  }

  function setCameraInteraction(enabled: boolean) {
    const controller = viewer.scene.screenSpaceCameraController;
    controller.enableRotate = enabled;
    controller.enableTranslate = enabled;
    controller.enableZoom = enabled;
    controller.enableTilt = enabled;
    controller.enableLook = enabled;
  }

  handler.setInputAction((event: { position: Cartesian2 }) => {
    handleLeftDown(event.position);
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction((event: { endPosition: Cartesian2 }) => {
    handleMouseMove(event.endPosition);
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(() => {
    handleLeftUp();
  }, ScreenSpaceEventType.LEFT_UP);

  handler.setInputAction((event: { position: Cartesian2 }) => {
    handleLeftClick(event.position);
  }, ScreenSpaceEventType.LEFT_CLICK);

  function destroy() {
    setCameraInteraction(true);
    handler.destroy();
  }

  return {
    destroy,
  };
}
