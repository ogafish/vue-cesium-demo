package com.example.pipeline.api.dto;

public record JobItemDto(String targetType, String targetId, String status, String tilesetUrl, String errorMessage) {
}
