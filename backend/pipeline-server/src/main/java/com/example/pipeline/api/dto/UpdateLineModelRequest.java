package com.example.pipeline.api.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateLineModelRequest(
    @NotNull Double radius,
    @NotNull Double thickness,
    String businessTypeId,
    String modelId
) {
}
