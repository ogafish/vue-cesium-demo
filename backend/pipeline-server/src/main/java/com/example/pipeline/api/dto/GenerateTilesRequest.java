package com.example.pipeline.api.dto;

import jakarta.validation.constraints.NotNull;

public record GenerateTilesRequest(
    @NotNull String targetType,
    @NotNull String targetId,
    String outputSubdir
) {
}
