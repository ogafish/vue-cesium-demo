import type { PipeModelOption } from "../types/pipeline";
import {
  getAllowedPipeModelIdsForBusiness,
  normalizePipeModelForBusiness,
} from "./pipelineDefaults";

export const DEFAULT_PIPE_MODEL_ID = "procedural-round";

export const PIPE_MODEL_OPTIONS: PipeModelOption[] = [
  {
    id: "procedural-round",
    name: "默认圆管风格",
    description: "使用项目自建程序化空心圆管；外观默认跟随业务类型颜色。",
  },
  {
    id: "pipe-pp-pvc",
    name: "PP/PVC 细纹风格",
    description: "塑料给排水管常见质感，增加细微轴向纹理、低金属度和较高粗糙度；业务类型仍控制整体颜色。",
  },
  {
    id: "hdpe-black-gas",
    name: "HDPE 黑色燃气管",
    description: "模拟黑色聚乙烯燃气管，包含低反光塑料表面、细微拉挤纹理和黄色轴向识别条。",
  },
  {
    id: "carbon-steel-new",
    name: "工业碳钢无缝管 - 全新",
    description: "写实银灰碳钢管质感，金属度高、粗糙度低，保留细微轧制纹路和浅焊印；业务类型作为全局调色。",
  },
  {
    id: "straight-9-metal",
    name: "工业碳钢无缝管 - 轻度锈蚀",
    description: "银灰金属底色叠加少量橙褐锈斑、油污暗渍和焊缝热印，金属度与粗糙度按局部磨损变化。",
  },
  {
    id: "carbon-steel-heavy-rust",
    name: "工业碳钢无缝管 - 重度锈蚀",
    description: "重锈蚀碳钢表面，锈蚀区域金属度明显下降、粗糙度和腐蚀麻点增强；业务类型仍作为全局调色。",
  },
  {
    id: "coated-matte",
    name: "磨砂涂层风格",
    description: "适合喷涂或防腐涂层管线，强调高粗糙度、低反光和均匀涂层颗粒感。",
  },
  {
    id: "ductile-iron-epoxy",
    name: "球墨铸铁环氧涂层管",
    description: "模拟给水工程常见球墨铸铁管，包含环氧涂层、局部涂层磨损、铸铁细坑和中等金属基底感。",
  },
  {
    id: "frp-sand-pipe",
    name: "玻璃钢夹砂管",
    description: "模拟排水和输水场景中的玻璃钢夹砂管，包含纤维斜纹、砂粒粗糙感和低金属度复合材料质感。",
  },
  {
    id: "galvanized-steel",
    name: "镀锌钢管",
    description: "模拟镀锌钢管的锌花晶粒、纵向接缝和中高金属反光，适合小口径给水或附属管段展示。",
  },
];

export function getBusinessModelOptions(businessTypeId?: string | null) {
  const allowedModelIds = new Set(getAllowedPipeModelIdsForBusiness(businessTypeId));

  return PIPE_MODEL_OPTIONS.filter((option) => allowedModelIds.has(option.id));
}

export function getNormalizedBusinessModelId(businessTypeId?: string | null, modelId?: string | null) {
  return normalizePipeModelForBusiness(businessTypeId, modelId);
}
