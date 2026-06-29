package com.example.pipeline.service;

import com.example.pipeline.api.dto.PipeBusinessTypeDto;
import com.example.pipeline.api.dto.PipeConnectionBranchDto;
import com.example.pipeline.api.dto.PipeConnectionDirectionDto;
import com.example.pipeline.api.dto.PipeCoordinateDto;
import com.example.pipeline.api.dto.PipeEndpointDto;
import com.example.pipeline.api.dto.PipeJointDto;
import com.example.pipeline.api.dto.PipeLineDto;
import com.example.pipeline.domain.GeoMath;
import com.example.pipeline.domain.GeoMath.Vector3;
import com.example.pipeline.domain.PipelineRules;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class PipelineTilesConfigBuilder {
    private final PipelineQueryService queryService;

    public PipelineTilesConfigBuilder(PipelineQueryService queryService) {
        this.queryService = queryService;
    }

    public Map<String, Object> buildLineTilesConfig(PipeLineDto line, String outputSubdir) {
        List<PipeLineDto> lines = queryService.allLines();
        List<PipeJointDto> joints = queryService.allJoints();
        String businessTypeId = PipelineRules.normalizeBusinessType(line.businessTypeId());
        PipeBusinessTypeDto businessType = queryService.businessTypes().stream()
            .filter(item -> item.id().equals(businessTypeId))
            .findFirst()
            .orElse(new PipeBusinessTypeDto("water", "\u7ed9\u6c34", "#2f80ed"));
        double socketScale = socketScale(line, joints);
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("id", line.id());
        config.put("kind", "straight");
        config.put("outputSubdir", outputSubdir);
        config.put("start", socketAdjustedEndpoint(line, "start", joints, socketScale));
        config.put("end", socketAdjustedEndpoint(line, "end", joints, socketScale));
        config.put("model", Map.of("id", PipelineRules.normalizeModelForBusiness(businessTypeId, line.modelId(), false)));
        config.put("shape", Map.of(
            "type", "round",
            "outerRadius", line.shape().radius(),
            "wallThickness", line.shape().thickness(),
            "radialSegments", 96
        ));
        config.put("material", Map.of(
            "name", businessType.name(),
            "color", businessType.color(),
            "metallicFactor", 0.06,
            "roughnessFactor", 0.46
        ));
        return config;
    }

    public Map<String, Object> buildJointTilesConfig(PipeJointDto joint, String outputSubdir) {
        List<PipeLineDto> lines = queryService.allLines();
        List<PipeJointDto> joints = queryService.allJoints();
        String businessTypeId = PipelineRules.normalizeBusinessType(joint.businessTypeId());
        PipeBusinessTypeDto businessType = queryService.businessTypes().stream()
            .filter(item -> item.id().equals(businessTypeId))
            .findFirst()
            .orElse(new PipeBusinessTypeDto("water", "\u7ed9\u6c34", "#2f80ed"));
        double outerRadius = PipelineRules.jointOuterRadius(joint);
        double wallThickness = Math.min(
            outerRadius * 0.45,
            Math.max(0.02, joint.branches().stream().mapToDouble(PipeConnectionBranchDto::wallThickness).max().orElse(0.02))
        );
        double branchLength = PipelineRules.effectiveJointBranchLength(joint.jointKind(), joint.degree(), outerRadius);
        double socketLength = PipelineRules.jointSocketLength(joint);

        List<Map<String, Object>> branches = new ArrayList<>();
        for (PipeConnectionBranchDto branch : joint.branches()) {
            PipeLineDto line = lines.stream().filter(candidate -> candidate.id().equals(branch.lineId())).findFirst().orElse(null);
            double scale = line == null ? 1 : socketScale(line, joints);
            branches.add(new LinkedHashMap<>(Map.of(
                "lineId", branch.lineId(),
                "direction", Map.of("x", branch.direction().x(), "y", branch.direction().y(), "z", branch.direction().z()),
                "socketCenter", socketCutPosition(joint, branch.direction(), socketLength * scale),
                "outerRadius", branch.outerRadius(),
                "wallThickness", branch.wallThickness()
            )));
        }

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("id", joint.id());
        config.put("kind", "joint");
        config.put("jointKind", joint.jointKind());
        config.put("outputSubdir", outputSubdir);
        config.put("center", Map.of("lon", joint.position().lon(), "lat", joint.position().lat(), "height", joint.position().height()));
        config.put("model", Map.of("id", PipelineRules.normalizeModelForBusiness(businessTypeId, joint.modelId(), false)));
        config.put("branchLength", branchLength);
        config.put("socketLength", socketLength);
        config.put("branches", branches);
        config.put("shape", Map.of(
            "type", "round",
            "outerRadius", outerRadius,
            "wallThickness", wallThickness,
            "radialSegments", 72
        ));
        config.put("material", Map.of(
            "name", joint.jointLabel() + "\u63a5\u5934",
            "color", businessType.color(),
            "metallicFactor", 0.08,
            "roughnessFactor", 0.42
        ));
        return config;
    }

    private Map<String, Object> socketAdjustedEndpoint(
        PipeLineDto line,
        String role,
        List<PipeJointDto> joints,
        double scale
    ) {
        JointBranchMatch match = findLineJointBranch(line, role, joints);
        if (match == null) {
            PipeEndpointDto endpoint = "start".equals(role) ? line.start() : line.end();
            return positionMap(endpoint.lon(), endpoint.lat(), endpoint.height());
        }
        return socketCutPosition(match.joint(), match.branch().direction(), PipelineRules.jointSocketLength(match.joint()) * scale);
    }

    private JointBranchMatch findLineJointBranch(PipeLineDto line, String role, List<PipeJointDto> joints) {
        for (PipeJointDto joint : joints) {
            for (PipeConnectionBranchDto branch : joint.branches()) {
                if (branch.lineId().equals(line.id()) && branch.endpointRole().equals(role)) {
                    return new JointBranchMatch(joint, branch);
                }
            }
        }
        return null;
    }

    private Map<String, Object> socketCutPosition(PipeJointDto joint, PipeConnectionDirectionDto direction, double length) {
        Vector3 center = GeoMath.ecef(joint.position().lon(), joint.position().lat(), joint.position().height());
        Vector3 raw = new Vector3(direction.x(), direction.y(), direction.z());
        if (GeoMath.magnitude(raw) < 1e-6 || length <= 0) {
            return positionMap(joint.position().lon(), joint.position().lat(), joint.position().height());
        }
        Vector3 cut = GeoMath.add(center, GeoMath.multiply(GeoMath.normalize(raw), length));
        PipeCoordinateDto coordinate = GeoMath.geodetic(cut);
        return positionMap(coordinate.lon(), coordinate.lat(), coordinate.height());
    }

    private Map<String, Object> positionMap(double lon, double lat, double height) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("lon", lon);
        map.put("lat", lat);
        map.put("height", height);
        return map;
    }

    private double socketScale(PipeLineDto line, List<PipeJointDto> joints) {
        double start = endpointSocketLength(line, "start", joints);
        double end = endpointSocketLength(line, "end", joints);
        double total = start + end;
        if (total <= 0) {
            return 1;
        }
        double maxSocketLength = Math.max(0, line.length() - Math.max(line.shape().radius() * 1.2, 0.3));
        return total > maxSocketLength ? maxSocketLength / total : 1;
    }

    private double endpointSocketLength(PipeLineDto line, String role, List<PipeJointDto> joints) {
        JointBranchMatch match = findLineJointBranch(line, role, joints);
        return match == null ? 0 : PipelineRules.jointSocketLength(match.joint());
    }

    private record JointBranchMatch(PipeJointDto joint, PipeConnectionBranchDto branch) {
    }
}
