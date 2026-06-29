package com.example.pipeline.api.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateJointKindRequest(@NotNull String jointKind) {
}
