package com.example.pipeline.config;

import java.nio.file.Path;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class PipelineWebConfig implements WebMvcConfigurer {
    private final Path frontendRoot;

    public PipelineWebConfig(PipelineProperties pipelineProperties) {
        this.frontendRoot = Path.of(pipelineProperties.frontendRoot()).toAbsolutePath().normalize();
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String generatedPath = frontendRoot
            .resolve("public")
            .resolve("pipeline-tiles")
            .resolve("generated")
            .toUri()
            .toString();

        if (!generatedPath.endsWith("/")) {
            generatedPath = generatedPath + "/";
        }

        registry.addResourceHandler("/pipeline-tiles/generated/**")
            .addResourceLocations(generatedPath);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
            .allowedOriginPatterns("*")
            .allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("*");
    }
}
