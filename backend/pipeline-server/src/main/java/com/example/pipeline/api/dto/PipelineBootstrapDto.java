package com.example.pipeline.api.dto;

import java.util.List;
import java.util.Map;

public record PipelineBootstrapDto(
    ProjectDto project,
    List<PipeLayerDto> layers,
    List<PipeBusinessTypeDto> businessTypes,
    List<PipeModelOptionDto> modelOptions,
    Map<String, List<String>> businessModelOptions,
    Map<String, String> defaultModelByBusiness,
    List<PipePointDto> points,
    List<PipeLineDto> lines,
    List<PipeJointDto> joints,
    List<String> tilesetUrls
) {
}
