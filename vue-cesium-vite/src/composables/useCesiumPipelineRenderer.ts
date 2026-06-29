import { watch } from "vue";
import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  Entity,
  HeightReference,
  PolylineDashMaterialProperty,
  Viewer,
} from "cesium";
import type { PipelineStore } from "./usePipelineStore";
import type {
  PipeConnectionNode,
  PipeEndpoint,
  PipeJoint,
  PipeJointKind,
  PipeLine,
  PipePoint,
} from "../types/pipeline";
import {
  endpointToCartesian,
  lonLatHeightToCartesian,
  makeAxisPositions,
  makePipeVolumeShape,
  pointToCartesian,
} from "../utils/pipelineGeometry";
import { flyToPipelineLine, flyToPipelinePoint } from "../utils/pipelineCamera";
import {
  buildPipeJointTilesConfig,
  getPipeVisualEndpointCartesian,
} from "../utils/pipelineTilesConfig";
import {
  buildThreeWayJointGeometry,
  interpolateSleeveRadius,
  makeSleeveRadii,
  sampleSocketArcCenterline,
} from "../utils/pipelineJointArcGeometry.js";
import {
  DEFAULT_PIPE_BUSINESS_TYPE_ID,
  PIPELINE_AXIS_BASE_LENGTH_METERS,
  normalizePipeBusinessTypeId,
} from "../constants/pipelineDefaults";
import { resolvePipelineHighlightColor } from "../constants/pipelineHighlight";

type PipelineEntity = Entity & {
  pipelineType?: string;
  pointId?: string;
  lineId?: string;
  connectionNodeId?: string;
  jointId?: string;
  endpointRole?: "start" | "end";
  axis?: "x" | "y" | "z";
};

type FourWaySleeveEntitySegment =
  | {
      type: "hub";
      keySuffix: "four-way-hub";
      position: Cartesian3;
      radius: number;
    }
  | {
      type: "branch";
      keySuffix: string;
      positions: Cartesian3[];
      radius: number;
    };

const STRAIGHT_JOINT_ENTITY_SEGMENTS = 8;
const ARC_JOINT_ENTITY_SEGMENTS = 16;
const THREE_WAY_JOINT_ENTITY_SEGMENTS = 18;
const PIPE_ENTITY_ALPHA = 1;
const JOINT_ENTITY_ALPHA = 1;
const DEFAULT_PIPELINE_OUTLINE_COLOR = Color.WHITE.withAlpha(0.72);
const DEFAULT_PIPELINE_OUTLINE_WIDTH = 1;
const SELECTED_PIPELINE_OUTLINE_WIDTH = 4;
const SELECTED_PIPELINE_COLOR = Color.fromCssColorString(resolvePipelineHighlightColor("selected"));
const SELECTED_PIPELINE_OUTLINE_COLOR = Color.WHITE;

export function useCesiumPipelineRenderer(viewer: Viewer, store: PipelineStore) {
  // 用独立 DataSource 承载管网 entity，便于统一清理并避免污染 Viewer 默认集合。
  const dataSource = new CustomDataSource("pipeline-data-source");
  const entityByKey = new Map<string, Entity>();
  viewer.dataSources.add(dataSource);

  function getBusinessTypeColor(businessTypeId?: string) {
    const normalizedBusinessTypeId = normalizePipeBusinessTypeId(businessTypeId);
    const businessType =
      store.state.businessTypes.find((item) => item.id === normalizedBusinessTypeId) ??
      store.state.businessTypes.find((item) => item.id === DEFAULT_PIPE_BUSINESS_TYPE_ID);

    return Color.fromCssColorString(businessType?.color ?? "#2f80ed");
  }

  function setPipelineProperties(entity: Entity, properties: Partial<PipelineEntity>) {
    // Cesium Entity 自定义属性用于交互层识别点击对象类型。
    Object.assign(entity as PipelineEntity, properties);
  }

  function shouldShowLineEntity(line: PipeLine) {
    const hasVisibleDetailModel =
      line.detailModelStatus === "loaded" ||
      (line.detailModelStatus === "generating" && Boolean(line.detailTilesetUrl));

    // dirty means the old 3D Tiles no longer matches current business geometry.
    // Show the entity fallback so the rough model uses the same socket/cutback points as the next tileset.
    return !hasVisibleDetailModel;
  }

  function getJointColor(jointKind: PipeJointKind) {
    const colors: Record<PipeJointKind, Color> = {
      terminal: Color.TRANSPARENT,
      straight: Color.fromCssColorString("#7dd3fc"),
      uBend: Color.fromCssColorString("#38bdf8"),
      threeWay: Color.fromCssColorString("#34d399"),
      fourWay: Color.fromCssColorString("#a78bfa"),
      multi: Color.fromCssColorString("#f472b6"),
    };

    return colors[jointKind];
  }

  function getSelectedPipelineColor() {
    return SELECTED_PIPELINE_COLOR;
  }

  function cartesianToVector(cartesian: Cartesian3) {
    return [cartesian.x, cartesian.y, cartesian.z];
  }

  function vectorToCartesian(vector: number[]) {
    return new Cartesian3(vector[0], vector[1], vector[2]);
  }

  function normalizePlainDirection(direction: number[]) {
    const cartesian = new Cartesian3(direction[0], direction[1], direction[2]);
    return cartesianToVector(Cartesian3.normalize(cartesian, cartesian));
  }

  function buildFourWayBranchGeometry(node: PipeConnectionNode) {
    const joint = store.getJointByNodeId(node.id);

    if (!joint || joint.jointKind !== "fourWay" || joint.branches.length !== 4) {
      return null;
    }

    const config = buildPipeJointTilesConfig(joint, store.state.lines, store.state.businessTypes, {
      joints: store.state.joints,
    });
    const center = lonLatHeightToCartesian(config.center.lon, config.center.lat, config.center.height);
    const branches = config.branches.map((branch) => {
      const socketCenter = lonLatHeightToCartesian(
        branch.socketCenter.lon,
        branch.socketCenter.lat,
        branch.socketCenter.height,
      );

      return {
        ...branch,
        direction: normalizePlainDirection([branch.direction.x, branch.direction.y, branch.direction.z]),
        socketCenter,
      };
    });
    const maxBranchOuterRadius = Math.max(...branches.map((branch) => branch.outerRadius));
    const maxBranchWallThickness = Math.max(...branches.map((branch) => branch.wallThickness));

    return {
      center,
      branches,
      hubRadius: Math.max(
        maxBranchOuterRadius * 1.12,
        maxBranchOuterRadius + maxBranchWallThickness * 0.6,
      ),
    };
  }

  function makeStraightSleeveRadii(
    startPipeOuterRadius: number,
    endPipeOuterRadius: number,
    startPipeWallThickness: number,
    endPipeWallThickness: number,
  ) {
    // entity 只能显示实心 polylineVolume；这里取套筒外径，真实空心结构由 3D Tiles mesh 表达。
    return makeSleeveRadii({
      startPipeOuterRadius,
      endPipeOuterRadius,
      startPipeWallThickness,
      endPipeWallThickness,
      wallThickness: Math.max(startPipeWallThickness, endPipeWallThickness),
    });
  }

  function getTwoBranchSleeveConfig(node: PipeConnectionNode, jointKind: PipeJointKind) {
    const joint = store.getJointByNodeId(node.id);

    if (!joint || joint.jointKind !== jointKind || joint.branches.length < 2) {
      return null;
    }

    const config = buildPipeJointTilesConfig(joint, store.state.lines, store.state.businessTypes, {
      joints: store.state.joints,
    });
    const [startBranch, endBranch] = config.branches;

    if (!startBranch || !endBranch) {
      return null;
    }

    return { joint, config, startBranch, endBranch };
  }

  function getStraightSleeveGeometry(node: PipeConnectionNode) {
    const sleeveConfig = getTwoBranchSleeveConfig(node, "straight");
    if (!sleeveConfig) {
      return null;
    }
    const { startBranch, endBranch } = sleeveConfig;

    const start = lonLatHeightToCartesian(
      startBranch.socketCenter.lon,
      startBranch.socketCenter.lat,
      startBranch.socketCenter.height,
    );
    const end = lonLatHeightToCartesian(
      endBranch.socketCenter.lon,
      endBranch.socketCenter.lat,
      endBranch.socketCenter.height,
    );

    if (Cartesian3.distance(start, end) <= 0.001) {
      return null;
    }

    return {
      start,
      end,
      ...makeStraightSleeveRadii(
        startBranch.outerRadius,
        endBranch.outerRadius,
        startBranch.wallThickness,
        endBranch.wallThickness,
      ),
    };
  }

  function getStraightSleeveSegmentPositions(
    geometry: NonNullable<ReturnType<typeof getStraightSleeveGeometry>>,
    segmentIndex: number,
  ) {
    const startRatio = segmentIndex / STRAIGHT_JOINT_ENTITY_SEGMENTS;
    const endRatio = (segmentIndex + 1) / STRAIGHT_JOINT_ENTITY_SEGMENTS;

    return [
      Cartesian3.lerp(geometry.start, geometry.end, startRatio, new Cartesian3()),
      Cartesian3.lerp(geometry.start, geometry.end, endRatio, new Cartesian3()),
    ];
  }

  function getStraightSleeveSegmentRadius(
    geometry: NonNullable<ReturnType<typeof getStraightSleeveGeometry>>,
    segmentIndex: number,
  ) {
    const midRatio = (segmentIndex + 0.5) / STRAIGHT_JOINT_ENTITY_SEGMENTS;

    return interpolateSleeveRadius(
      geometry.startOuterRadius,
      geometry.endOuterRadius,
      midRatio,
    );
  }

  function makeStraightSleeveSegmentShape(
    geometry: NonNullable<ReturnType<typeof getStraightSleeveGeometry>>,
    segmentIndex: number,
  ) {
    const radius = getStraightSleeveSegmentRadius(geometry, segmentIndex);

    return makePipeVolumeShape({
      type: "circle",
      radius,
      thickness: Math.max(0.02, radius * 0.12),
      flangeLength: 0,
      flangeThickness: 0,
    });
  }

  function getArcSleeveGeometry(node: PipeConnectionNode) {
    const sleeveConfig = getTwoBranchSleeveConfig(node, "uBend");
    if (!sleeveConfig) {
      return null;
    }
    const { config, startBranch, endBranch } = sleeveConfig;
    const start = lonLatHeightToCartesian(
      startBranch.socketCenter.lon,
      startBranch.socketCenter.lat,
      startBranch.socketCenter.height,
    );
    const end = lonLatHeightToCartesian(
      endBranch.socketCenter.lon,
      endBranch.socketCenter.lat,
      endBranch.socketCenter.height,
    );
    const center = lonLatHeightToCartesian(config.center.lon, config.center.lat, config.center.height);

    if (Cartesian3.distance(start, end) <= 0.001) {
      return null;
    }

    const arc = sampleSocketArcCenterline({
      start: cartesianToVector(start),
      end: cartesianToVector(end),
      center: cartesianToVector(center),
      curvatureScale: 0.45,
      segments: ARC_JOINT_ENTITY_SEGMENTS,
    });

    return {
      path: arc.points.map(vectorToCartesian),
      ...makeStraightSleeveRadii(
        startBranch.outerRadius,
        endBranch.outerRadius,
        startBranch.wallThickness,
        endBranch.wallThickness,
      ),
    };
  }

  function getArcSleeveSegmentPositions(
    geometry: NonNullable<ReturnType<typeof getArcSleeveGeometry>>,
    segmentIndex: number,
  ) {
    return [geometry.path[segmentIndex], geometry.path[segmentIndex + 1]];
  }

  function getArcSleeveSegmentRadius(
    geometry: NonNullable<ReturnType<typeof getArcSleeveGeometry>>,
    segmentIndex: number,
  ) {
    const midRatio = (segmentIndex + 0.5) / ARC_JOINT_ENTITY_SEGMENTS;

    return interpolateSleeveRadius(
      geometry.startOuterRadius,
      geometry.endOuterRadius,
      midRatio,
    );
  }

  function makeArcSleeveSegmentShape(
    geometry: NonNullable<ReturnType<typeof getArcSleeveGeometry>>,
    segmentIndex: number,
  ) {
    const radius = getArcSleeveSegmentRadius(geometry, segmentIndex);

    return makePipeVolumeShape({
      type: "circle",
      radius,
      thickness: Math.max(0.02, radius * 0.12),
      flangeLength: 0,
      flangeThickness: 0,
    });
  }

  function getThreeWaySleeveEntitySegments(node: PipeConnectionNode) {
    const joint = store.getJointByNodeId(node.id);

    if (!joint || joint.jointKind !== "threeWay" || joint.branches.length !== 3) {
      return [];
    }

    const config = buildPipeJointTilesConfig(joint, store.state.lines, store.state.businessTypes, {
      joints: store.state.joints,
    });
    const branches = config.branches.map((branch) => {
      const socketCenter = lonLatHeightToCartesian(
        branch.socketCenter.lon,
        branch.socketCenter.lat,
        branch.socketCenter.height,
      );

      return {
        ...branch,
        socketCenter: cartesianToVector(socketCenter),
      };
    });
    const center = lonLatHeightToCartesian(config.center.lon, config.center.lat, config.center.height);
    const threeWayGeometry = buildThreeWayJointGeometry({
      branches,
      center: cartesianToVector(center),
      curvatureScale: 0.45,
      segments: THREE_WAY_JOINT_ENTITY_SEGMENTS,
    });
    const segments: Array<{ keySuffix: string; positions: Cartesian3[]; radius: number }> = [];

    function pushPathSegments(
      keyPrefix: string,
      path: number[][],
      startPipeOuterRadius: number,
      endPipeOuterRadius: number,
      startPipeWallThickness: number,
      endPipeWallThickness: number,
    ) {
      const radii = makeStraightSleeveRadii(
        startPipeOuterRadius,
        endPipeOuterRadius,
        startPipeWallThickness,
        endPipeWallThickness,
      );

      for (let index = 0; index < path.length - 1; index += 1) {
        const midRatio = (index + 0.5) / Math.max(1, path.length - 1);
        const radius = interpolateSleeveRadius(
          radii.startOuterRadius,
          radii.endOuterRadius,
          midRatio,
        );

        segments.push({
          keySuffix: `${keyPrefix}:${index}`,
          positions: [vectorToCartesian(path[index]), vectorToCartesian(path[index + 1])],
          radius,
        });
      }
    }

    for (const [pairIndex, pair] of threeWayGeometry.pairs.entries()) {
      const firstBranch = branches[pair.firstIndex];
      const secondBranch = branches[pair.secondIndex];

      // 三通演示方案只画三根完整弯管，中心重叠暂不遮盖。
      pushPathSegments(
        `three-way-pair:${pairIndex}`,
        pair.path,
        firstBranch.outerRadius,
        secondBranch.outerRadius,
        firstBranch.wallThickness,
        secondBranch.wallThickness,
      );
    }

    return segments;
  }

  function getFourWaySleeveEntitySegments(node: PipeConnectionNode): FourWaySleeveEntitySegment[] {
    const geometry = buildFourWayBranchGeometry(node);

    if (!geometry) {
      return [];
    }

    const segments: FourWaySleeveEntitySegment[] = [{
      type: "hub",
      keySuffix: "four-way-hub",
      position: geometry.center,
      radius: geometry.hubRadius,
    }];

    for (const [branchIndex, branch] of geometry.branches.entries()) {
      const radii = makeStraightSleeveRadii(
        branch.outerRadius,
        branch.outerRadius,
        branch.wallThickness,
        branch.wallThickness,
      );
      const start = Cartesian3.add(
        geometry.center,
        Cartesian3.multiplyByScalar(vectorToCartesian(branch.direction), -geometry.hubRadius * 0.18, new Cartesian3()),
        new Cartesian3(),
      );

      segments.push({
        type: "branch",
        keySuffix: `four-way-branch:${branchIndex}`,
        positions: [start, branch.socketCenter],
        radius: interpolateSleeveRadius(radii.startOuterRadius, radii.endOuterRadius, 0.5),
      });
    }

    return segments;
  }

  function makeThreeWaySleeveSegmentShape(radius: number) {
    return makePipeVolumeShape({
      type: "circle",
      radius,
      thickness: Math.max(0.02, radius * 0.12),
      flangeLength: 0,
      flangeThickness: 0,
    });
  }

  function makeFourWaySleeveSegmentShape(radius: number) {
    return makePipeVolumeShape({
      type: "circle",
      radius,
      thickness: Math.max(0.02, radius * 0.12),
      flangeLength: 0,
      flangeThickness: 0,
    });
  }

  function shouldRenderJoint(node: PipeConnectionNode) {
    return node.jointKind !== "terminal";
  }

  function shouldShowJointEntity(joint: PipeJoint) {
    const hasVisibleDetailModel =
      joint.detailModelStatus === "loaded" ||
      (joint.detailModelStatus === "generating" && Boolean(joint.detailTilesetUrl));

    // dirty 只表示需要重建，不代表新接头已经可见；此时保留 entity，避免正确业务接头被提前隐藏。
    return !hasVisibleDetailModel;
  }

  function createPointEntity(point: PipePoint) {
    const color = getBusinessTypeColor(point.businessTypeId);
    const entity = dataSource.entities.add({
      id: `pipeline-point-${point.id}`,
      show: store.state.showPipePoints,
      position: pointToCartesian(point),
      point: {
        pixelSize: 12,
        color,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: HeightReference.NONE,
      },
    });

    setPipelineProperties(entity, {
      pipelineType: "point",
      pointId: point.id,
    });
    entityByKey.set(`point:${point.id}`, entity);
  }

  function createLineEntity(line: PipeLine) {
    const color = getBusinessTypeColor(line.businessTypeId);
    const positions = makeLinePositions(line);
    const entity = dataSource.entities.add({
      id: `pipeline-line-${line.id}`,
      show: shouldShowLineEntity(line),
      polylineVolume: {
        positions,
        shape: makePipeVolumeShape(line.shape),
        material: color.withAlpha(PIPE_ENTITY_ALPHA),
        outline: true,
        outlineColor: DEFAULT_PIPELINE_OUTLINE_COLOR,
        outlineWidth: DEFAULT_PIPELINE_OUTLINE_WIDTH,
      },
    });

    setPipelineProperties(entity, {
      pipelineType: "line",
      lineId: line.id,
    });
    entityByKey.set(`line:${line.id}`, entity);

    // Endpoint handles are visual handles only; business snapping still resolves to the real endpoint.
    // They must use socket-cut positions so entity fallback and 3D Tiles occupy the same geometry.
    createEndpointHandle(line, "start", makeLineEndpointHandlePosition(line, "start"));
    createEndpointHandle(line, "end", makeLineEndpointHandlePosition(line, "end"));
    removeBendTangentHandles(line.id);
  }

  function makeLineEndpointHandlePosition(line: PipeLine, role: "start" | "end") {
    return getPipeVisualEndpointCartesian(line, role, store.state.businessTypes, {
      joints: store.state.joints,
      lines: store.state.lines,
    });
  }

  function makeLinePositions(line: PipeLine) {
    // Entity centerline and 3D Tiles centerline both derive from the same business socket-cut endpoints.
    return [
      makeLineEndpointHandlePosition(line, "start"),
      makeLineEndpointHandlePosition(line, "end"),
    ];
  }

  function createEndpointHandle(line: PipeLine, role: "start" | "end", position: Cartesian3) {
    const entity = dataSource.entities.add({
      id: `pipeline-line-endpoint-${line.id}-${role}`,
      show: store.state.showPipePoints,
      position,
      point: {
        pixelSize: 9,
        color: Color.YELLOW,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    setPipelineProperties(entity, {
      pipelineType: "line-endpoint",
      lineId: line.id,
      endpointRole: role,
    });
    entityByKey.set(`line-endpoint:${line.id}:${role}`, entity);
  }

  function createStraightSleeveSegmentEntity(node: PipeConnectionNode, segmentIndex: number) {
    const geometry = getStraightSleeveGeometry(node);

    if (!geometry) {
      return;
    }

    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);
    const entity = dataSource.entities.add({
      id: `pipeline-connection-joint-${node.id}-straight-sleeve-${segmentIndex}`,
      polylineVolume: {
        positions: getStraightSleeveSegmentPositions(geometry, segmentIndex),
        shape: makeStraightSleeveSegmentShape(geometry, segmentIndex),
        material: color.withAlpha(JOINT_ENTITY_ALPHA),
        outline: true,
        outlineColor: DEFAULT_PIPELINE_OUTLINE_COLOR,
        outlineWidth: DEFAULT_PIPELINE_OUTLINE_WIDTH,
      },
    });

    setPipelineProperties(entity, {
      pipelineType: "connection-joint",
      connectionNodeId: node.id,
      jointId: store.getJointByNodeId(node.id)?.id,
    });
    entityByKey.set(`connection-joint:${node.id}:straight-sleeve:${segmentIndex}`, entity);
  }

  function updateStraightSleeveSegmentEntity(node: PipeConnectionNode, segmentIndex: number) {
    const key = `connection-joint:${node.id}:straight-sleeve:${segmentIndex}`;
    const existing = entityByKey.get(key);
    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);
    const geometry = getStraightSleeveGeometry(node);

    if (
      joint?.jointKind !== "straight" ||
      !shouldRenderJoint(node) ||
      !geometry ||
      (joint && !shouldShowJointEntity(joint))
    ) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      return;
    }

    if (!existing?.polylineVolume) {
      createStraightSleeveSegmentEntity(node, segmentIndex);
      return;
    }

    // entity 层复用 socket 圆心算法，但用多段 polylineVolume 近似 3D Tiles 的连续变径套筒。
    existing.polylineVolume.positions = getStraightSleeveSegmentPositions(geometry, segmentIndex) as never;
    existing.polylineVolume.shape = makeStraightSleeveSegmentShape(geometry, segmentIndex) as never;
    existing.polylineVolume.material = new ColorMaterialProperty(color.withAlpha(JOINT_ENTITY_ALPHA)) as never;
  }

  function createArcSleeveSegmentEntity(node: PipeConnectionNode, segmentIndex: number) {
    const geometry = getArcSleeveGeometry(node);

    if (!geometry) {
      return;
    }

    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);
    const entity = dataSource.entities.add({
      id: `pipeline-connection-joint-${node.id}-arc-sleeve-${segmentIndex}`,
      polylineVolume: {
        positions: getArcSleeveSegmentPositions(geometry, segmentIndex),
        shape: makeArcSleeveSegmentShape(geometry, segmentIndex),
        material: color.withAlpha(JOINT_ENTITY_ALPHA),
        outline: true,
        outlineColor: DEFAULT_PIPELINE_OUTLINE_COLOR,
        outlineWidth: DEFAULT_PIPELINE_OUTLINE_WIDTH,
      },
    });

    setPipelineProperties(entity, {
      pipelineType: "connection-joint",
      connectionNodeId: node.id,
      jointId: store.getJointByNodeId(node.id)?.id,
    });
    entityByKey.set(`connection-joint:${node.id}:arc-sleeve:${segmentIndex}`, entity);
  }

  function updateArcSleeveSegmentEntity(node: PipeConnectionNode, segmentIndex: number) {
    const key = `connection-joint:${node.id}:arc-sleeve:${segmentIndex}`;
    const existing = entityByKey.get(key);
    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);
    const geometry = getArcSleeveGeometry(node);

    if (
      joint?.jointKind !== "uBend" ||
      !shouldRenderJoint(node) ||
      !geometry ||
      (joint && !shouldShowJointEntity(joint))
    ) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      return;
    }

    if (!existing?.polylineVolume) {
      createArcSleeveSegmentEntity(node, segmentIndex);
      return;
    }

    // 平滑连接头 entity 使用和 3D Tiles 相同的 socket 圆心与节点附近圆弧，只用分段 polylineVolume 近似连续变径。
    existing.polylineVolume.positions = getArcSleeveSegmentPositions(geometry, segmentIndex) as never;
    existing.polylineVolume.shape = makeArcSleeveSegmentShape(geometry, segmentIndex) as never;
    existing.polylineVolume.material = new ColorMaterialProperty(color.withAlpha(JOINT_ENTITY_ALPHA)) as never;
  }

  function createThreeWaySleeveSegmentEntity(
    node: PipeConnectionNode,
    segment: ReturnType<typeof getThreeWaySleeveEntitySegments>[number],
  ) {
    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);
    const entity = dataSource.entities.add({
      id: `pipeline-connection-joint-${node.id}-${segment.keySuffix}`,
      polylineVolume: {
        positions: segment.positions,
        shape: makeThreeWaySleeveSegmentShape(segment.radius),
        material: color.withAlpha(JOINT_ENTITY_ALPHA),
        outline: true,
        outlineColor: DEFAULT_PIPELINE_OUTLINE_COLOR,
        outlineWidth: DEFAULT_PIPELINE_OUTLINE_WIDTH,
      },
    });

    setPipelineProperties(entity, {
      pipelineType: "connection-joint",
      connectionNodeId: node.id,
      jointId: store.getJointByNodeId(node.id)?.id,
    });
    entityByKey.set(`connection-joint:${node.id}:${segment.keySuffix}`, entity);
  }

  function updateThreeWaySleeveSegmentEntity(
    node: PipeConnectionNode,
    segment: ReturnType<typeof getThreeWaySleeveEntitySegments>[number],
  ) {
    const key = `connection-joint:${node.id}:${segment.keySuffix}`;
    const existing = entityByKey.get(key);
    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);

    if (
      joint?.jointKind !== "threeWay" ||
      !shouldRenderJoint(node) ||
      (joint && !shouldShowJointEntity(joint))
    ) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      return;
    }

    if (!existing?.polylineVolume) {
      createThreeWaySleeveSegmentEntity(node, segment);
      return;
    }

    // 三通 entity 是 3D Tiles 前的业务几何占位，必须使用同一套 socket/cutback 和共享圆弧结果。
    existing.polylineVolume.positions = segment.positions as never;
    existing.polylineVolume.shape = makeThreeWaySleeveSegmentShape(segment.radius) as never;
    existing.polylineVolume.material = new ColorMaterialProperty(color.withAlpha(JOINT_ENTITY_ALPHA)) as never;
  }

  function createFourWaySleeveSegmentEntity(
    node: PipeConnectionNode,
    segment: FourWaySleeveEntitySegment,
  ) {
    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);
    const entityOptions = segment.type === "hub"
      ? {
          id: `pipeline-connection-joint-${node.id}-${segment.keySuffix}`,
          position: segment.position,
          ellipsoid: {
            radii: new Cartesian3(segment.radius, segment.radius, segment.radius),
            material: color.withAlpha(JOINT_ENTITY_ALPHA),
            outline: true,
            outlineColor: DEFAULT_PIPELINE_OUTLINE_COLOR,
            outlineWidth: DEFAULT_PIPELINE_OUTLINE_WIDTH,
          },
        }
      : {
          id: `pipeline-connection-joint-${node.id}-${segment.keySuffix}`,
          polylineVolume: {
            positions: segment.positions,
            shape: makeFourWaySleeveSegmentShape(segment.radius),
            material: color.withAlpha(JOINT_ENTITY_ALPHA),
            outline: true,
            outlineColor: DEFAULT_PIPELINE_OUTLINE_COLOR,
            outlineWidth: DEFAULT_PIPELINE_OUTLINE_WIDTH,
          },
        };
    const entity = dataSource.entities.add(entityOptions);

    setPipelineProperties(entity, {
      pipelineType: "connection-joint",
      connectionNodeId: node.id,
      jointId: store.getJointByNodeId(node.id)?.id,
    });
    entityByKey.set(`connection-joint:${node.id}:${segment.keySuffix}`, entity);
  }

  function updateFourWaySleeveSegmentEntity(
    node: PipeConnectionNode,
    segment: FourWaySleeveEntitySegment,
  ) {
    const key = `connection-joint:${node.id}:${segment.keySuffix}`;
    const existing = entityByKey.get(key);
    const joint = store.getJointByNodeId(node.id);
    const color = getJointColor(joint?.jointKind ?? node.jointKind);

    if (
      joint?.jointKind !== "fourWay" ||
      !shouldRenderJoint(node) ||
      (joint && !shouldShowJointEntity(joint))
    ) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      return;
    }

    if (segment.type === "hub") {
      if (!existing?.ellipsoid) {
        if (existing) {
          dataSource.entities.remove(existing);
          entityByKey.delete(key);
        }
        createFourWaySleeveSegmentEntity(node, segment);
        return;
      }

      existing.position = segment.position as never;
      existing.ellipsoid.radii = new Cartesian3(segment.radius, segment.radius, segment.radius) as never;
      existing.ellipsoid.material = new ColorMaterialProperty(color.withAlpha(JOINT_ENTITY_ALPHA)) as never;
      return;
    }

    if (!existing?.polylineVolume) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      createFourWaySleeveSegmentEntity(node, segment);
      return;
    }

    existing.polylineVolume.positions = segment.positions as never;
    existing.polylineVolume.shape = makeFourWaySleeveSegmentShape(segment.radius) as never;
    existing.polylineVolume.material = new ColorMaterialProperty(color.withAlpha(JOINT_ENTITY_ALPHA)) as never;
  }

  function updateConnectionJointEntity(node: PipeConnectionNode) {
    const joint = store.getJointByNodeId(node.id);

    if (!shouldRenderJoint(node) || (joint && !shouldShowJointEntity(joint))) {
      return;
    }

    const jointKind = joint?.jointKind ?? node.jointKind;

    if (jointKind === "straight") {
      for (let segmentIndex = 0; segmentIndex < STRAIGHT_JOINT_ENTITY_SEGMENTS; segmentIndex += 1) {
        updateStraightSleeveSegmentEntity(node, segmentIndex);
      }
      return;
    }

    if (jointKind === "uBend") {
      for (let segmentIndex = 0; segmentIndex < ARC_JOINT_ENTITY_SEGMENTS; segmentIndex += 1) {
        updateArcSleeveSegmentEntity(node, segmentIndex);
      }
      return;
    }

    if (jointKind === "threeWay") {
      for (const segment of getThreeWaySleeveEntitySegments(node)) {
        updateThreeWaySleeveSegmentEntity(node, segment);
      }
      return;
    }

    if (jointKind === "fourWay") {
      for (const segment of getFourWaySleeveEntitySegments(node)) {
        updateFourWaySleeveSegmentEntity(node, segment);
      }
    }
  }

  function updateEndpointHandle(line: PipeLine, role: "start" | "end", position: Cartesian3) {
    const key = `line-endpoint:${line.id}:${role}`;
    const existing = entityByKey.get(key);

    if (existing) {
      // 管线端点 handle 本质也是管点类视觉标记；隐藏管点时同步隐藏，但仍保留吸附坐标数据。
      existing.show = store.state.showPipePoints;
      existing.position = position as never;
      return;
    }

    createEndpointHandle(line, role, position);
  }

  function removeBendTangentHandles(lineId: string) {
    for (const role of ["start", "end"] as const) {
      const key = `bend-tangent:${lineId}:${role}`;
      const entity = entityByKey.get(key);

      if (entity) {
        dataSource.entities.remove(entity);
        entityByKey.delete(key);
      }
    }
  }

  function updateLineEntity(line: PipeLine) {
    const key = `line:${line.id}`;
    const existing = entityByKey.get(key);

    if (!existing?.polylineVolume) {
      createLineEntity(line);
      return;
    }

    const color = getBusinessTypeColor(line.businessTypeId);
    // 精细模型已存在时隐藏普通管体；生成失败或首次生成中时保留普通管体作为兜底。
    existing.show = shouldShowLineEntity(line);
    existing.polylineVolume.positions = makeLinePositions(line) as never;
    existing.polylineVolume.shape = makePipeVolumeShape(line.shape) as never;
    existing.polylineVolume.material = new ColorMaterialProperty(color.withAlpha(PIPE_ENTITY_ALPHA)) as never;
    existing.polylineVolume.outlineColor = DEFAULT_PIPELINE_OUTLINE_COLOR as never;
    existing.polylineVolume.outlineWidth = DEFAULT_PIPELINE_OUTLINE_WIDTH as never;

    updateEndpointHandle(line, "start", makeLineEndpointHandlePosition(line, "start"));
    updateEndpointHandle(line, "end", makeLineEndpointHandlePosition(line, "end"));
    // 弯管切点是内部几何控制信息，默认不在场景中显示；这里清理热更新或旧版本残留的切点 handle。
    removeBendTangentHandles(line.id);
  }

  function syncPointEntities() {
    // store.points 是源数据；这里做增量同步和删除陈旧 entity。
    const wantedKeys = new Set(store.state.points.map((point) => `point:${point.id}`));

    for (const point of store.state.points) {
      const key = `point:${point.id}`;
      const existing = entityByKey.get(key);
      if (existing) {
        existing.show = store.state.showPipePoints;
        existing.position = pointToCartesian(point) as never;
      } else {
        createPointEntity(point);
      }
    }

    for (const [key, entity] of entityByKey.entries()) {
      if (key.startsWith("point:") && !wantedKeys.has(key)) {
        dataSource.entities.remove(entity);
        entityByKey.delete(key);
      }
    }
  }

  function syncLineEntities() {
    // 管线 entity 和端点 handle 都从 store.lines 派生，避免 Cesium 场景状态落后于业务数据。
    const wantedLineKeys = new Set(store.state.lines.map((line) => `line:${line.id}`));
    const wantedEndpointKeys = new Set<string>();

    for (const line of store.state.lines) {
      wantedEndpointKeys.add(`line-endpoint:${line.id}:start`);
      wantedEndpointKeys.add(`line-endpoint:${line.id}:end`);
      updateLineEntity(line);
    }

    for (const [key, entity] of entityByKey.entries()) {
      const isStaleLine = key.startsWith("line:") && !wantedLineKeys.has(key);
      const isStaleEndpoint =
        key.startsWith("line-endpoint:") && !wantedEndpointKeys.has(key);
      const isStaleBendTangent = key.startsWith("bend-tangent:");

      if (isStaleLine || isStaleEndpoint || isStaleBendTangent) {
        dataSource.entities.remove(entity);
        entityByKey.delete(key);
      }
    }
  }

  function syncConnectionJointEntities() {
    const wantedKeys = new Set<string>();

    for (const node of store.state.connectionNodes) {
      const joint = store.getJointByNodeId(node.id);
      const jointKind = joint?.jointKind ?? node.jointKind;

      if (!shouldRenderJoint(node) || (joint && !shouldShowJointEntity(joint))) {
        continue;
      }

      if (jointKind === "straight") {
        for (let segmentIndex = 0; segmentIndex < STRAIGHT_JOINT_ENTITY_SEGMENTS; segmentIndex += 1) {
          wantedKeys.add(`connection-joint:${node.id}:straight-sleeve:${segmentIndex}`);
        }
        continue;
      }

      if (jointKind === "uBend") {
        for (let segmentIndex = 0; segmentIndex < ARC_JOINT_ENTITY_SEGMENTS; segmentIndex += 1) {
          wantedKeys.add(`connection-joint:${node.id}:arc-sleeve:${segmentIndex}`);
        }
        continue;
      }

      if (jointKind === "threeWay") {
        // threeWay entity 分段数量由共享几何的截断结果决定，不能用固定数量推断。
        for (const segment of getThreeWaySleeveEntitySegments(node)) {
          wantedKeys.add(`connection-joint:${node.id}:${segment.keySuffix}`);
        }
        continue;
      }

      if (jointKind === "fourWay") {
        for (const segment of getFourWaySleeveEntitySegments(node)) {
          wantedKeys.add(`connection-joint:${node.id}:${segment.keySuffix}`);
        }
      }
    }

    for (const node of store.state.connectionNodes) {
      updateConnectionJointEntity(node);
    }

    for (const [key, entity] of entityByKey.entries()) {
      if (
        key.startsWith("connection-joint:") &&
        !wantedKeys.has(key)
      ) {
        dataSource.entities.remove(entity);
        entityByKey.delete(key);
      }
    }
  }

  function syncDraftPoint() {
    // 临时管点不进入正式数据列表，仅用于确认前的位置预览和三轴拖拽。
    const key = "draft:point";
    const existing = entityByKey.get(key);

    if (!store.state.pointDraft) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      removeAxisEntities();
      return;
    }

    if (existing) {
      existing.position = store.state.pointDraft.cartesian as never;
    } else {
      const entity = dataSource.entities.add({
        id: "pipeline-draft-point",
        position: store.state.pointDraft.cartesian,
        point: {
          pixelSize: 14,
          color: Color.LIME,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      setPipelineProperties(entity, {
        pipelineType: "draft-point",
      });
      entityByKey.set(key, entity);
    }

    syncAxisEntities();
  }

  function syncAxisEntities() {
    if (!store.state.pointDraft) {
      removeAxisEntities();
      return;
    }

    const axisDefinitions = [
      { axis: "x" as const, color: Color.RED },
      { axis: "y" as const, color: Color.LIME },
      { axis: "z" as const, color: Color.DODGERBLUE },
    ];
    const cameraDistance = Cartesian3.distance(
      viewer.camera.positionWC,
      store.state.pointDraft.cartesian,
    );
    // 三轴长度随相机距离缩放，保证远近视角下都能点选。
    const length = Math.max(PIPELINE_AXIS_BASE_LENGTH_METERS, cameraDistance * 0.04);

    for (const item of axisDefinitions) {
      const key = `axis:${item.axis}`;
      const positions = makeAxisPositions(store.state.pointDraft.cartesian, item.axis, length);
      const existing = entityByKey.get(key);

      if (existing) {
        existing.polyline!.positions = positions as never;
      } else {
        const entity = dataSource.entities.add({
          id: `pipeline-axis-${item.axis}`,
          polyline: {
            positions,
            width: 8,
            material: item.color,
            clampToGround: false,
          },
        });
        setPipelineProperties(entity, {
          pipelineType: "axis",
          axis: item.axis,
        });
        entityByKey.set(key, entity);
      }
    }
  }

  function removeAxisEntities() {
    for (const key of ["axis:x", "axis:y", "axis:z"]) {
      const entity = entityByKey.get(key);
      if (entity) {
        dataSource.entities.remove(entity);
        entityByKey.delete(key);
      }
    }
  }

  function syncPreviewLine() {
    // 预览线只展示 lineDraft，不写入正式管线列表。
    const key = "draft:line";
    const existing = entityByKey.get(key);
    const { start, end } = store.state.lineDraft;
    const material = new PolylineDashMaterialProperty({
      color: getBusinessTypeColor(store.state.lineDraft.businessTypeId).withAlpha(0.95),
      dashLength: 16,
    });

    if (!start || !end) {
      if (existing) {
        dataSource.entities.remove(existing);
        entityByKey.delete(key);
      }
      return;
    }

    const positions = makeDraftLinePositions(start, end);

    if (existing) {
      existing.polyline!.positions = positions as never;
      existing.polyline!.material = material as never;
      return;
    }

    const entity = dataSource.entities.add({
      id: "pipeline-draft-line",
      polyline: {
        positions,
        width: 5,
        material,
        clampToGround: false,
      },
    });
    setPipelineProperties(entity, {
      pipelineType: "draft-line",
    });
    entityByKey.set(key, entity);
  }

  function clearPreviewLine() {
    const existing = entityByKey.get("draft:line");

    if (existing) {
      // 确认生成正式管线后立即移除黄色虚线，避免 watcher 异步时序导致预览残留在精细模型上方。
      dataSource.entities.remove(existing);
      entityByKey.delete("draft:line");
    }
  }

  function makeDraftLinePositions(
    start: PipeEndpoint,
    end: PipeEndpoint | null,
  ) {
    return [
      endpointToCartesian(start),
      ...(end ? [endpointToCartesian(end)] : []),
    ];
  }

  function syncSelectionStyle() {
    // 选中态只改变显示样式，不改变管点/管线业务数据。
    const selectedColor = getSelectedPipelineColor();
    const selectedOutlineColor = SELECTED_PIPELINE_OUTLINE_COLOR;

    for (const point of store.state.points) {
      const entity = entityByKey.get(`point:${point.id}`);
      if (!entity?.point) {
        continue;
      }

      const isSelected =
        store.state.selectedObject?.type === "point" && store.state.selectedObject.id === point.id;
      entity.point.outlineColor = isSelected ? Color.YELLOW : Color.WHITE;
      entity.point.outlineWidth = isSelected ? 4 : 2;
    }

    for (const line of store.state.lines) {
      const entity = entityByKey.get(`line:${line.id}`);
      if (!entity?.polylineVolume) {
        continue;
      }

      const isSelected =
        store.state.selectedObject?.type === "line" && store.state.selectedObject.id === line.id;
      entity.polylineVolume.material = new ColorMaterialProperty(
        (isSelected ? selectedColor : getBusinessTypeColor(line.businessTypeId)).withAlpha(PIPE_ENTITY_ALPHA),
      ) as never;
      entity.polylineVolume.outlineColor = isSelected
        ? selectedOutlineColor
        : DEFAULT_PIPELINE_OUTLINE_COLOR;
      entity.polylineVolume.outlineWidth = (
        isSelected ? SELECTED_PIPELINE_OUTLINE_WIDTH : DEFAULT_PIPELINE_OUTLINE_WIDTH
      ) as never;
    }

    for (const node of store.state.connectionNodes) {
      const joint = store.getJointByNodeId(node.id);
      const isSelected =
        Boolean(joint) &&
        store.state.selectedObject?.type === "joint" &&
        store.state.selectedObject.id === joint?.id;
      const materialColor = isSelected ? selectedColor : getJointColor(joint?.jointKind ?? node.jointKind);
      const outlineColor = isSelected ? selectedOutlineColor : DEFAULT_PIPELINE_OUTLINE_COLOR;
      const outlineWidth = isSelected ? SELECTED_PIPELINE_OUTLINE_WIDTH : DEFAULT_PIPELINE_OUTLINE_WIDTH;
      const materialAlpha = JOINT_ENTITY_ALPHA;

      for (const [key, entity] of entityByKey) {
        if (!key.startsWith(`connection-joint:${node.id}:`)) {
          continue;
        }

        if (entity.polylineVolume) {
          entity.polylineVolume.material = new ColorMaterialProperty(
            materialColor.withAlpha(materialAlpha),
          ) as never;
          entity.polylineVolume.outlineColor = outlineColor as never;
          entity.polylineVolume.outlineWidth = outlineWidth as never;
        }

        if (entity.ellipsoid) {
          entity.ellipsoid.material = new ColorMaterialProperty(
            materialColor.withAlpha(materialAlpha),
          ) as never;
          entity.ellipsoid.outlineColor = outlineColor as never;
          entity.ellipsoid.outlineWidth = outlineWidth as never;
        }
      }
    }
  }

  function getDataSource() {
    return dataSource;
  }

  function getEntityByKey(key: string) {
    return entityByKey.get(key) ?? null;
  }

  function flyToPoint(id: string) {
    const point = store.getPointById(id);
    if (point) {
      // 管点可能在地下，使用业务坐标计算稳定视角，不依赖 Cesium 对地下 entity 的自动包围体定位。
      flyToPipelinePoint(viewer, point);
      return true;
    }

    return false;
  }

  function flyToFallbackLine(id: string) {
    const line = store.getLineById(id);
    if (line) {
      // 精细 3D Tiles 存在时普通管线 entity 会隐藏，因此定位必须跟业务管线坐标走。
      flyToPipelineLine(viewer, line, {
        points: store.state.points,
        lines: store.state.lines,
      });
      return true;
    }

    return false;
  }

  const stopSync = watch(
    () => ({
      points: store.state.points.map((point) => ({ ...point })),
      lines: store.state.lines.map((line) => ({ ...line })),
      pointDraft: store.state.pointDraft,
      lineDraftStart: store.state.lineDraft.start,
      lineDraftEnd: store.state.lineDraft.end,
      lineDraftBusinessTypeId: store.state.lineDraft.businessTypeId,
      draftRevision: store.state.draftRevision,
      showPipePoints: store.state.showPipePoints,
      connectionNodes: store.state.connectionNodes.map((node) => ({
        ...node,
        branches: node.branches.map((branch) => ({ ...branch })),
      })),
      joints: store.state.joints.map((joint) => ({
        id: joint.id,
        nodeId: joint.nodeId,
        detailModelStatus: joint.detailModelStatus,
        detailTilesetUrl: joint.detailTilesetUrl,
        geometrySignature: joint.geometrySignature,
      })),
      selectedObject: store.state.selectedObject,
    }),
    () => {
      syncPointEntities();
      syncLineEntities();
      syncConnectionJointEntities();
      syncDraftPoint();
      syncPreviewLine();
      syncSelectionStyle();
    },
    { deep: true, immediate: true },
  );

  const stopFlyTo = watch(
    () => store.state.flyToRequest,
    (request) => {
      if (!request) {
        return;
      }

      if (request.type === "point") {
        flyToPoint(request.id);
      } else {
        flyToFallbackLine(request.id);
      }

      store.clearFlyToRequest();
    },
  );

  function destroy() {
    stopSync();
    stopFlyTo();
    entityByKey.clear();
    dataSource.entities.removeAll();
    viewer.dataSources.remove(dataSource, true);
  }

  return {
    getDataSource,
    getEntityByKey,
    clearPreviewLine,
    flyToPoint,
    flyToLine: flyToFallbackLine,
    flyToFallbackLine,
    destroy,
  };
}

export type CesiumPipelineRenderer = ReturnType<typeof useCesiumPipelineRenderer>;
