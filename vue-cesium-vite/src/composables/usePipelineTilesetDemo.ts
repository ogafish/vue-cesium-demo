import { readonly, ref } from "vue";
import {
  Cesium3DTileStyle,
  Cesium3DTileColorBlendMode,
  Cesium3DTileset,
  HeadingPitchRange,
  Math as CesiumMath,
  Viewer,
} from "cesium";
import { resolvePipelineHighlightColor } from "../constants/pipelineHighlight";

const PIPE_TILESET_LOAD_OPTIONS = {};

type GeneratedTilesetSelection =
  | {
      type: "line" | "joint";
      id: string;
    }
  | null;

type LoadGeneratedTilesetOptions = {
  flyTo?: boolean;
};

export function usePipelineTilesetDemo(viewer: Viewer) {
  // Keep generated 3D Tiles separate from entity rendering; business IDs are mapped here for picking.
  const status = ref("未加载");
  const isLoaded = ref(false);
  const generatedTilesets = new Map<string, Cesium3DTileset>();
  const generatedLineIdsByTileset = new WeakMap<Cesium3DTileset, string>();
  const generatedJointIdsByTileset = new WeakMap<Cesium3DTileset, string>();
  const originalBlendModeByTileset = new WeakMap<Cesium3DTileset, Cesium3DTileColorBlendMode>();
  const originalBlendAmountByTileset = new WeakMap<Cesium3DTileset, number>();
  let selectedTilesetObject: GeneratedTilesetSelection = null;

  function makeSelectedPipeStyle() {
    // 3D Tiles style does not provide a real outline for b3dm models; use an opaque
    // bright replacement color so dark materials do not mute the selection.
    const color = resolvePipelineHighlightColor("selected");
    return new Cesium3DTileStyle({
      color: `color('${color}', 1.0)`,
    });
  }

  function isSelectedTileset(generatedTileset: Cesium3DTileset) {
    if (!selectedTilesetObject) {
      return false;
    }

    if (selectedTilesetObject.type === "line") {
      return generatedLineIdsByTileset.get(generatedTileset) === selectedTilesetObject.id;
    }

    return generatedJointIdsByTileset.get(generatedTileset) === selectedTilesetObject.id;
  }

  function rememberOriginalBlendState(generatedTileset: Cesium3DTileset) {
    if (!originalBlendModeByTileset.has(generatedTileset)) {
      originalBlendModeByTileset.set(generatedTileset, generatedTileset.colorBlendMode);
    }
    if (!originalBlendAmountByTileset.has(generatedTileset)) {
      originalBlendAmountByTileset.set(generatedTileset, generatedTileset.colorBlendAmount);
    }
  }

  function applySelectedTilesetStyle(generatedTileset: Cesium3DTileset) {
    rememberOriginalBlendState(generatedTileset);
    generatedTileset.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE;
    generatedTileset.colorBlendAmount = 1;
    generatedTileset.style = makeSelectedPipeStyle();
  }

  function restoreTilesetStyle(generatedTileset: Cesium3DTileset) {
    const originalBlendMode = originalBlendModeByTileset.get(generatedTileset);
    const originalBlendAmount = originalBlendAmountByTileset.get(generatedTileset);
    if (originalBlendMode !== undefined) {
      generatedTileset.colorBlendMode = originalBlendMode;
    }
    if (originalBlendAmount !== undefined) {
      generatedTileset.colorBlendAmount = originalBlendAmount;
    }
    generatedTileset.style = undefined;
  }

  function syncGeneratedTilesetSelection() {
    for (const generatedTileset of generatedTilesets.values()) {
      if (isSelectedTileset(generatedTileset)) {
        applySelectedTilesetStyle(generatedTileset);
      } else {
        restoreTilesetStyle(generatedTileset);
      }
    }
  }

  function rememberGeneratedLineTileset(url: string, tileset: Cesium3DTileset, lineId?: string) {
    if (!lineId) {
      return;
    }

    // 当前是一条业务管线对应一个独立 tileset；这里建立 Cesium 对象到业务 lineId 的反查关系。
    generatedLineIdsByTileset.set(tileset, lineId);
  }

  function rememberGeneratedJointTileset(tileset: Cesium3DTileset, jointId?: string) {
    if (!jointId) {
      return;
    }

    // 接头 3D Tiles 也要能反查业务 jointId，避免点击接头只产生视觉效果。
    generatedJointIdsByTileset.set(tileset, jointId);
  }

  function getPickedTileset(picked: unknown) {
    const candidate = picked as {
      primitive?: unknown;
      tileset?: unknown;
      content?: {
        tileset?: unknown;
      };
    } | null;
    const possibleTilesets = [
      candidate?.primitive,
      candidate?.tileset,
      candidate?.content?.tileset,
    ];

    // 不同 3D Tiles 内容类型的 pick 结果字段不完全一致，按常见字段逐个兜底匹配。
    return possibleTilesets.find((value) => value instanceof Cesium3DTileset) ?? null;
  }

  async function loadGeneratedLineTileset(
    url: string,
    label = "精细管线 3D Tiles",
    lineId?: string,
    options: LoadGeneratedTilesetOptions = {},
  ) {
    const shouldFlyTo = options.flyTo ?? true;
    const existing = generatedTilesets.get(url);
    if (existing) {
      rememberGeneratedLineTileset(url, existing, lineId);
      syncGeneratedTilesetSelection();
      status.value = `${label} 已加载`;
      if (shouldFlyTo) {
        await viewer.flyTo(existing, {
          offset: new HeadingPitchRange(
            CesiumMath.toRadians(45),
            CesiumMath.toRadians(-35),
            160,
          ),
        });
      }
      return;
    }

    status.value = `正在加载${label}...`;

    try {
      // 新增管线生成的 tileset 独立保存，允许多条精细管线同时留在场景中。
      const generatedTileset = await Cesium3DTileset.fromUrl(url, PIPE_TILESET_LOAD_OPTIONS);
      viewer.scene.primitives.add(generatedTileset);
      generatedTilesets.set(url, generatedTileset);
      rememberGeneratedLineTileset(url, generatedTileset, lineId);
      syncGeneratedTilesetSelection();
      isLoaded.value = true;
      status.value = `${label} 已加载`;
      if (shouldFlyTo) {
        await viewer.flyTo(generatedTileset, {
          offset: new HeadingPitchRange(
            CesiumMath.toRadians(45),
            CesiumMath.toRadians(-35),
            160,
          ),
        });
      }
    } catch (error) {
      status.value = `加载失败：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  async function loadGeneratedJointTileset(url: string, label = "精细接头 3D Tiles", jointId?: string) {
    const existing = generatedTilesets.get(url);
    if (existing) {
      rememberGeneratedJointTileset(existing, jointId);
      syncGeneratedTilesetSelection();
      status.value = `${label} 已加载`;
      return;
    }

    status.value = `正在加载${label}...`;

    try {
      // 接头模型和管线模型共享 generatedTilesets，但通过 WeakMap 区分业务对象类型。
      const generatedTileset = await Cesium3DTileset.fromUrl(url, PIPE_TILESET_LOAD_OPTIONS);
      viewer.scene.primitives.add(generatedTileset);
      generatedTilesets.set(url, generatedTileset);
      rememberGeneratedJointTileset(generatedTileset, jointId);
      syncGeneratedTilesetSelection();
      isLoaded.value = true;
      status.value = `${label} 已加载`;
    } catch (error) {
      status.value = `加载失败：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  function unloadGeneratedLineTileset(url: string) {
    const generatedTileset = generatedTilesets.get(url);
    if (!generatedTileset) {
      return;
    }

    // 删除业务管线时同步移除对应精细 3D Tiles，避免留下孤立模型。
    viewer.scene.primitives.remove(generatedTileset);
    generatedTilesets.delete(url);
    generatedLineIdsByTileset.delete(generatedTileset);
    generatedJointIdsByTileset.delete(generatedTileset);
    status.value = "已卸载精细管线 3D Tiles";
    isLoaded.value = generatedTilesets.size > 0;
  }

  function unloadGeneratedJointTileset(url: string) {
    const generatedTileset = generatedTilesets.get(url);
    if (!generatedTileset) {
      return;
    }

    // 拓扑变化后旧接头模型必须卸载，否则会和新接头重叠。
    viewer.scene.primitives.remove(generatedTileset);
    generatedTilesets.delete(url);
    generatedJointIdsByTileset.delete(generatedTileset);
    generatedLineIdsByTileset.delete(generatedTileset);
    status.value = "已卸载精细接头 3D Tiles";
    isLoaded.value = generatedTilesets.size > 0;
  }

  function getLineIdFromPickedObject(picked: unknown) {
    const pickedTileset = getPickedTileset(picked);

    if (!pickedTileset) {
      return null;
    }

    // 只有能反查到真实业务 lineId 的 3D Tiles pick 才参与选中，避免“视觉选中但业务无状态”的假拾取。
    return generatedLineIdsByTileset.get(pickedTileset) ?? null;
  }

  function getJointIdFromPickedObject(picked: unknown) {
    const pickedTileset = getPickedTileset(picked);

    if (!pickedTileset) {
      return null;
    }

    return generatedJointIdsByTileset.get(pickedTileset) ?? null;
  }

  function setSelectedGeneratedObject(selection: GeneratedTilesetSelection) {
    selectedTilesetObject = selection;
    syncGeneratedTilesetSelection();
  }

  function setSelectedGeneratedLine(lineId: string | null) {
    setSelectedGeneratedObject(lineId ? { type: "line", id: lineId } : null);
  }

  async function flyToGeneratedLineTileset(url: string) {
    const generatedTileset = generatedTilesets.get(url);

    if (!generatedTileset) {
      return false;
    }

    // 管线已经升级为精细 3D Tiles 后，定位应优先飞向真实可见模型，而不是隐藏的普通 entity。
    await viewer.flyTo(generatedTileset, {
      offset: new HeadingPitchRange(
        CesiumMath.toRadians(45),
        CesiumMath.toRadians(-35),
        160,
      ),
    });
    return true;
  }

  function destroy() {
    for (const generatedTileset of generatedTilesets.values()) {
      viewer.scene.primitives.remove(generatedTileset);
      generatedLineIdsByTileset.delete(generatedTileset);
      generatedJointIdsByTileset.delete(generatedTileset);
    }
    generatedTilesets.clear();
  }

  return {
    status: readonly(status),
    isLoaded: readonly(isLoaded),
    loadGeneratedLineTileset,
    loadGeneratedJointTileset,
    getLineIdFromPickedObject,
    getJointIdFromPickedObject,
    setSelectedGeneratedObject,
    setSelectedGeneratedLine,
    flyToGeneratedLineTileset,
    unloadGeneratedLineTileset,
    unloadGeneratedJointTileset,
    destroy,
  };
}
