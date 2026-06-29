package com.example.pipeline.api.dto;

public record PipeLineDto(
    String id,
    String kind,
    PipeEndpointDto start,
    PipeEndpointDto end,
    String startPointId,
    String endPointId,
    String layerId,
    String businessTypeId,
    String modelId,
    PipeShapeDto shape,
    double length,
    String connectionKey,
    String detailModelStatus,
    String detailTilesetUrl,
    String createdAt,
    String updatedAt
) {
}
