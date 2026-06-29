package com.example.pipeline.api.dto;

public record PipeEndpointDto(
    String endpointKey,
    String sourceType,
    String sourceId,
    double lon,
    double lat,
    double height,
    String pointId,
    String lineId,
    String endpointRole
) {
}
