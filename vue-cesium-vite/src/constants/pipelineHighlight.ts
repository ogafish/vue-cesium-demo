export type PipelineHighlightSemantic = "selected" | "burst" | "risk";

const PIPELINE_HIGHLIGHT_COLORS: Record<PipelineHighlightSemantic, string> = {
  selected: "#ffe45c",
  burst: "#ff3b30",
  risk: "#ffd60a",
};

export function resolvePipelineHighlightColor(semantic: PipelineHighlightSemantic = "selected") {
  return PIPELINE_HIGHLIGHT_COLORS[semantic];
}
