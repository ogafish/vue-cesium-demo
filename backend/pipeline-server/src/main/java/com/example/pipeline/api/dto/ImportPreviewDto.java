package com.example.pipeline.api.dto;

import java.util.List;
import java.util.Map;

public record ImportPreviewDto(
    long jobId,
    String status,
    int totalPoints,
    int totalLines,
    int errorCount,
    List<Map<String, Object>> pointPreview,
    List<Map<String, Object>> linePreview,
    List<ImportErrorDto> errors
) {
}
