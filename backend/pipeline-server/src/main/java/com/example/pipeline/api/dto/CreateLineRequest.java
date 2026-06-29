package com.example.pipeline.api.dto;

import jakarta.validation.constraints.NotNull;

public record CreateLineRequest(
    @NotNull PipeEndpointDto start,
    @NotNull PipeEndpointDto end,
    String businessTypeId,
    String modelId,
    PipeShapeDto shape,
    String layerId
) {
}
