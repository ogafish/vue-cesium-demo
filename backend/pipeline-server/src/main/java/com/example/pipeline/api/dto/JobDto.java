package com.example.pipeline.api.dto;

import java.util.List;

public record JobDto(
    long id,
    String type,
    String status,
    int totalCount,
    int successCount,
    int failedCount,
    String message,
    List<JobItemDto> items
) {
}
