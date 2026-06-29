package com.example.pipeline.api.dto;

public record PipelineMutationDto(
    String changedType,
    String changedId,
    PipelineBootstrapDto bootstrap
) {
}
