package com.example.pipeline.api.dto;

import java.util.List;

public record PipeJointDto(
    String id,
    String nodeId,
    String nodeKey,
    String pointId,
    String jointKind,
    String recommendedJointKind,
    String jointLabel,
    boolean manualOverride,
    PipeCoordinateDto position,
    int degree,
    List<String> connectionLineIds,
    List<PipeConnectionBranchDto> branches,
    List<String> branchLineIds,
    String businessTypeId,
    String modelId,
    String geometrySignature,
    String socketSignature,
    String detailModelStatus,
    String detailTilesetUrl,
    String createdAt,
    String updatedAt
) {
}
