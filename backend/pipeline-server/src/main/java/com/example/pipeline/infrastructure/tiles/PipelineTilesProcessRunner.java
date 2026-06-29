package com.example.pipeline.infrastructure.tiles;

import com.example.pipeline.config.PipelineProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

@Component
public class PipelineTilesProcessRunner {
    private final ObjectMapper objectMapper;
    private final Path frontendRoot;
    private final String nodeCommand;

    public PipelineTilesProcessRunner(ObjectMapper objectMapper, PipelineProperties pipelineProperties) {
        this.objectMapper = objectMapper;
        this.frontendRoot = Path.of(pipelineProperties.frontendRoot()).toAbsolutePath().normalize();
        this.nodeCommand = pipelineProperties.nodeCommand();
    }

    public double run(Map<String, Object> config) {
        Path configPath = null;
        try {
            Files.createDirectories(frontendRoot.resolve("public").resolve("pipeline-tiles").resolve("generated"));
            configPath = Files.createTempFile("pipeline-tiles-", ".json");
            Files.writeString(configPath, objectMapper.writeValueAsString(config), StandardCharsets.UTF_8);
            ProcessBuilder builder = new ProcessBuilder(
                nodeCommand,
                "scripts/generatePipeTilesFromConfig.mjs",
                configPath.toString()
            );
            builder.directory(frontendRoot.toFile());
            builder.redirectErrorStream(true);
            Process process = builder.start();
            boolean finished = process.waitFor(Duration.ofSeconds(120).toMillis(), TimeUnit.MILLISECONDS);
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (!finished) {
                process.destroyForcibly();
                throw new IllegalStateException("3D Tiles 生成超时");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException("3D Tiles 生成失败: " + output);
            }
            return parseLength(output);
        } catch (Exception error) {
            throw new IllegalStateException(error.getMessage(), error);
        } finally {
            if (configPath != null) {
                try {
                    Files.deleteIfExists(configPath);
                } catch (Exception ignored) {
                    // Temporary config cleanup failure does not affect business data.
                }
            }
        }
    }

    private double parseLength(String output) {
        for (String line : output.split("\\R")) {
            if (line.startsWith("Pipe length:")) {
                String value = line.replace("Pipe length:", "").replace("m", "").trim();
                try {
                    return Double.parseDouble(value);
                } catch (NumberFormatException ignored) {
                    return 0;
                }
            }
        }
        return 0;
    }
}
