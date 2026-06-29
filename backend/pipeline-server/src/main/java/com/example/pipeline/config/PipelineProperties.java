package com.example.pipeline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "pipeline")
public record PipelineProperties(
    String frontendRoot,
    String nodeCommand,
    String generatedUrlPrefix,
    Integer generationConcurrency
) {
}
