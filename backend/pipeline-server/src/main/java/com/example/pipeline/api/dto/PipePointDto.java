package com.example.pipeline.api.dto;

public record PipePointDto(
    String id,
    double lon,
    double lat,
    double height,
    Double groundHeight,
    double relativeHeight,
    double maishen,
    String layerId,
    String businessTypeId,
    String createdAt,
    String updatedAt
) {
}
