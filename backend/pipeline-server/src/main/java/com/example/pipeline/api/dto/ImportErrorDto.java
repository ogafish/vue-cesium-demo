package com.example.pipeline.api.dto;

public record ImportErrorDto(String sheetName, int rowNumber, String fieldName, String message) {
}
