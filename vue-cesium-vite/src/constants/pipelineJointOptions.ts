import type { PipeJointKind } from "../types/pipeline";

export const PIPE_JOINT_KIND_LABELS: Record<PipeJointKind, string> = {
  terminal: "端点",
  straight: "一字直通",
  uBend: "平滑圆弧连接头",
  threeWay: "平滑融合三通",
  fourWay: "平滑融合四通",
  multi: "多通节点",
};

export function getPipeJointKindLabel(jointKind: PipeJointKind) {
  return PIPE_JOINT_KIND_LABELS[jointKind] ?? jointKind;
}

export function normalizePipeJointKind(jointKind: string | undefined): PipeJointKind {
  // 兼容热更新或旧内存状态：旧 cross 统一迁移到 fourWay，旧两分支占位类型退回平滑圆弧。
  if (jointKind === "cross" || jointKind === "demoCross" || jointKind === "demoFourWay") {
    return "fourWay";
  }

  if (jointKind === "demoThreeWay") {
    return "threeWay";
  }

  if (jointKind === "elbow") {
    return "uBend";
  }

  if (jointKind && jointKind in PIPE_JOINT_KIND_LABELS) {
    return jointKind as PipeJointKind;
  }

  return "multi";
}

export function getEditableJointKindsByDegree(degree: number) {
  if (degree === 2) {
    return ["straight", "uBend"] satisfies PipeJointKind[];
  }

  if (degree === 3) {
    return ["threeWay"] satisfies PipeJointKind[];
  }

  if (degree === 4) {
    return ["fourWay"] satisfies PipeJointKind[];
  }

  return [] satisfies PipeJointKind[];
}
