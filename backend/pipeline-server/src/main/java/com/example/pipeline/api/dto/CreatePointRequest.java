package com.example.pipeline.api.dto;

import jakarta.validation.constraints.NotNull;

public record CreatePointRequest(
    @NotNull Double lon,
    @NotNull Double lat,
    @NotNull Double height,
    Double groundHeight,
    Double relativeHeight,
    Double maishen,
    String layerId,
    String businessTypeId
) {
}
