package com.example.pipeline.api.dto;

public record PipeShapeDto(String type, double radius, double thickness, double flangeLength, double flangeThickness) {
    public static PipeShapeDto circle(double radius, double thickness, double flangeLength, double flangeThickness) {
        return new PipeShapeDto("circle", radius, thickness, flangeLength, flangeThickness);
    }
}
