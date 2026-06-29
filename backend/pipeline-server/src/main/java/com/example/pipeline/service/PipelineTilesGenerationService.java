package com.example.pipeline.service;

import com.example.pipeline.api.dto.GenerateTilesRequest;
import com.example.pipeline.api.dto.GenerateTilesResult;
import com.example.pipeline.api.dto.JobDto;
import com.example.pipeline.api.dto.PipeJointDto;
import com.example.pipeline.api.dto.PipeLineDto;
import com.example.pipeline.config.PipelineProperties;
import com.example.pipeline.infrastructure.tiles.PipelineTilesProcessRunner;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class PipelineTilesGenerationService {
    private final PipelineQueryService queryService;
    private final PipelineGenerationJobService jobService;
    private final PipelineTilesConfigBuilder configBuilder;
    private final PipelineTilesProcessRunner processRunner;
    private final ObjectMapper objectMapper;
    private final String generatedUrlPrefix;

    public PipelineTilesGenerationService(
        PipelineQueryService queryService,
        PipelineGenerationJobService jobService,
        PipelineTilesConfigBuilder configBuilder,
        PipelineTilesProcessRunner processRunner,
        ObjectMapper objectMapper,
        PipelineProperties pipelineProperties
    ) {
        this.queryService = queryService;
        this.jobService = jobService;
        this.configBuilder = configBuilder;
        this.processRunner = processRunner;
        this.objectMapper = objectMapper;
        this.generatedUrlPrefix = pipelineProperties.generatedUrlPrefix() == null || pipelineProperties.generatedUrlPrefix().isBlank()
            ? "/pipeline-tiles/generated"
            : pipelineProperties.generatedUrlPrefix();
    }

    public GenerateTilesResult generateSingle(GenerateTilesRequest request) {
        String targetType = normalizeTargetType(request.targetType());
        String targetId = request.targetId();
        Map<String, Object> config = buildConfig(targetType, targetId, request.outputSubdir());
        double length = processRunner.run(config);
        String outputSubdir = String.valueOf(config.get("outputSubdir"));
        String url = generatedUrlPrefix + "/" + outputSubdir + "/tileset.json";
        if ("line".equals(targetType)) {
            jobService.markLineTileset(targetId, "loaded", url);
        } else {
            jobService.markJointTileset(targetId, "loaded", url);
        }
        return new GenerateTilesResult(targetType, targetId, url, length);
    }

    public JobDto generateProject() {
        queryService.bootstrap();
        List<Target> jointTargets = new ArrayList<>();
        for (PipeJointDto joint : queryService.allJoints()) {
            if (shouldGenerate(joint.detailModelStatus())) {
                jointTargets.add(new Target("joint", joint.id()));
            }
        }
        List<Target> lineTargets = new ArrayList<>();
        for (PipeLineDto line : queryService.allLines()) {
            if (shouldGenerate(line.detailModelStatus())) {
                lineTargets.add(new Target("line", line.id()));
            }
        }

        long jobId = jobService.createGenerationJob(jointTargets.size() + lineTargets.size());
        generateTargets(jobId, jointTargets);
        queryService.bootstrap();
        generateTargets(jobId, lineTargets);
        return jobService.getJob(jobId);
    }

    private void generateTargets(long jobId, List<Target> targets) {
        for (Target target : targets) {
            try {
                GenerateTilesResult result = generateSingle(new GenerateTilesRequest(target.type(), target.id(), null));
                jobService.addGenerationJobItem(jobId, target.type(), target.id(), "success", result.url(), null);
            } catch (Exception error) {
                if ("line".equals(target.type())) {
                    jobService.markLineTileset(target.id(), "failed", null);
                } else {
                    jobService.markJointTileset(target.id(), "failed", null);
                }
                jobService.addGenerationJobItem(jobId, target.type(), target.id(), "failed", null, error.getMessage());
            }
        }
    }

    private boolean shouldGenerate(String status) {
        return status == null || status.equals("none") || status.equals("dirty") || status.equals("failed");
    }

    private Map<String, Object> buildConfig(String targetType, String targetId, String requestedOutputSubdir) {
        if ("line".equals(targetType)) {
            PipeLineDto line = queryService.findLine(targetId);
            Map<String, Object> config = configBuilder.buildLineTilesConfig(line, line.id());
            config.put("outputSubdir", safeSubdir(
                requestedOutputSubdir,
                "default-line-" + line.id() + "-" + jobService.signatureHash(configSignature(config))
            ));
            return config;
        }
        PipeJointDto joint = queryService.findJoint(targetId);
        Map<String, Object> config = configBuilder.buildJointTilesConfig(joint, joint.id());
        config.put("outputSubdir", safeSubdir(
            requestedOutputSubdir,
            "default-joint-" + joint.id() + "-" + jobService.signatureHash(configSignature(config))
        ));
        return config;
    }

    private String configSignature(Map<String, Object> config) {
        try {
            Map<String, Object> copy = new java.util.TreeMap<>(config);
            copy.remove("outputSubdir");
            return objectMapper.writer()
                .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                .writeValueAsString(copy);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("无法计算模型生成配置签名", error);
        }
    }

    private String normalizeTargetType(String value) {
        if ("line".equals(value) || "joint".equals(value)) {
            return value;
        }
        throw new IllegalArgumentException("生成目标类型必须是 line 或 joint");
    }

    private String safeSubdir(String requested, String fallback) {
        String raw = requested == null || requested.isBlank() ? fallback : requested;
        return raw.replaceAll("[^a-zA-Z0-9_-]", "-");
    }

    private record Target(String type, String id) {
    }
}
