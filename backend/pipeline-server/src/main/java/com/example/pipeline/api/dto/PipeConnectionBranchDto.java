package com.example.pipeline.api.dto;

public record PipeConnectionBranchDto(
    String lineId,
    String endpointRole,
    String endpointKey,
    String lineKind,
    double outerRadius,
    double wallThickness,
    String businessTypeId,
    PipeConnectionDirectionDto direction
) {
}
