package com.example.pipeline.domain;

import com.example.pipeline.api.dto.PipeConnectionBranchDto;
import com.example.pipeline.api.dto.PipeConnectionDirectionDto;
import com.example.pipeline.api.dto.PipeCoordinateDto;
import com.example.pipeline.api.dto.PipeEndpointDto;
import com.example.pipeline.api.dto.PipeJointDto;
import com.example.pipeline.api.dto.PipeLineDto;
import com.example.pipeline.domain.GeoMath.Vector3;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

public final class PipelineTopology {
    private PipelineTopology() {
    }

    public static List<ConnectionNode> buildConnectionNodes(List<PipeLineDto> lines) {
        Map<String, MutableConnectionNode> byKey = new LinkedHashMap<>();
        for (PipeLineDto line : lines) {
            for (String role : List.of("start", "end")) {
                PipeEndpointDto endpoint = "start".equals(role) ? line.start() : line.end();
                String businessTypeId = PipelineRules.normalizeBusinessType(line.businessTypeId());
                String nodeKey = resolveEndpointKey(endpoint, lines) + "|business:" + businessTypeId;
                MutableConnectionNode node = byKey.computeIfAbsent(nodeKey, key -> new MutableConnectionNode(key));
                node.positions().add(GeoMath.ecef(endpoint.lon(), endpoint.lat(), endpoint.height()));
                PipeEndpointDto target = "start".equals(role) ? line.end() : line.start();
                Vector3 direction = GeoMath.normalize(GeoMath.subtract(
                    GeoMath.ecef(target.lon(), target.lat(), target.height()),
                    GeoMath.ecef(endpoint.lon(), endpoint.lat(), endpoint.height())
                ));
                node.branches().add(new PipeConnectionBranchDto(
                    line.id(),
                    role,
                    endpoint.endpointKey(),
                    line.kind(),
                    line.shape().radius(),
                    line.shape().thickness(),
                    businessTypeId,
                    new PipeConnectionDirectionDto(direction.x(), direction.y(), direction.z())
                ));
            }
        }

        List<ConnectionNode> nodes = new ArrayList<>();
        for (MutableConnectionNode mutable : byKey.values()) {
            Vector3 center = GeoMath.average(mutable.positions());
            PipeCoordinateDto position = GeoMath.geodetic(center);
            String recommendedKind = classifyJoint(mutable.branches());
            nodes.add(new ConnectionNode(
                makeNodeId(mutable.nodeKey()),
                mutable.nodeKey(),
                pointIdFromNodeKey(mutable.nodeKey()),
                position,
                mutable.branches().size(),
                mutable.branches().stream().map(PipeConnectionBranchDto::lineId).distinct().toList(),
                recommendedKind,
                recommendedKind,
                mutable.branches()
            ));
        }
        return nodes;
    }

    public static String classifyJoint(List<PipeConnectionBranchDto> branches) {
        if (branches.size() <= 1) {
            return "terminal";
        }
        if (branches.size() == 2) {
            double angle = GeoMath.angleBetween(branches.get(0).direction(), branches.get(1).direction());
            return angle >= PipelineRules.STRAIGHT_ANGLE_THRESHOLD_DEGREES ? "straight" : "uBend";
        }
        if (branches.size() == 3) {
            return "threeWay";
        }
        if (branches.size() == 4) {
            return "fourWay";
        }
        return "multi";
    }

    public static String resolveEndpointKey(PipeEndpointDto endpoint, List<PipeLineDto> lines) {
        return resolveEndpointKey(endpoint, lines, new HashSet<>());
    }

    public static String buildConnectionKey(PipeEndpointDto start, PipeEndpointDto end, List<PipeLineDto> lines) {
        return List.of(resolveEndpointKey(start, lines), resolveEndpointKey(end, lines)).stream().sorted().collect(Collectors.joining("|"));
    }

    public static String makeNodeId(String nodeKey) {
        return "N-" + nodeKey.replaceAll("[^a-zA-Z0-9_-]", "-");
    }

    public static String makeJointId(String nodeId) {
        return "J-" + nodeId;
    }

    public static String pointIdFromNodeKey(String nodeKey) {
        String raw = nodeKey.split("\\|business:")[0];
        return raw.startsWith("point:") ? raw.substring("point:".length()) : null;
    }

    public static String makeJointGeometrySignature(ConnectionNode node, String jointKind, String businessTypeId, String modelId) {
        String branchPart = node.branches().stream()
            .map(branch -> String.join(":",
                branch.lineId(),
                branch.endpointRole(),
                rounded(branch.outerRadius(), 3),
                rounded(branch.wallThickness(), 3),
                branch.businessTypeId() == null ? "" : branch.businessTypeId(),
                rounded(branch.direction().x(), 6),
                rounded(branch.direction().y(), 6),
                rounded(branch.direction().z(), 6)
            ))
            .sorted()
            .collect(Collectors.joining("|"));
        return String.join("#",
            PipelineRules.geometryVersion(jointKind),
            jointKind,
            businessTypeId == null ? "" : businessTypeId,
            modelId == null ? "" : modelId,
            rounded(node.position().lon(), 8),
            rounded(node.position().lat(), 8),
            rounded(node.position().height(), 3),
            branchPart
        );
    }

    public static String makeJointGeometrySignature(PipeJointDto joint, String jointKind, String businessTypeId, String modelId) {
        return makeJointGeometrySignature(new ConnectionNode(
            joint.nodeId(),
            joint.nodeKey(),
            joint.pointId(),
            joint.position(),
            joint.degree(),
            joint.connectionLineIds(),
            jointKind,
            joint.recommendedJointKind(),
            joint.branches()
        ), jointKind, businessTypeId, modelId);
    }

    public static String makeJointSocketSignature(ConnectionNode node) {
        String branchPart = node.branches().stream()
            .map(branch -> String.join(":",
                branch.lineId(),
                branch.endpointRole(),
                rounded(branch.outerRadius(), 3),
                rounded(branch.wallThickness(), 3),
                rounded(branch.direction().x(), 6),
                rounded(branch.direction().y(), 6),
                rounded(branch.direction().z(), 6)
            ))
            .sorted()
            .collect(Collectors.joining("|"));
        return String.join("#",
            PipelineRules.SOCKET_GEOMETRY_VERSION,
            node.jointKind(),
            String.valueOf(node.degree()),
            rounded(node.position().lon(), 8),
            rounded(node.position().lat(), 8),
            rounded(node.position().height(), 3),
            branchPart
        );
    }

    private static String resolveEndpointKey(PipeEndpointDto endpoint, List<PipeLineDto> lines, Set<String> visited) {
        if (endpoint == null) {
            return "";
        }
        if ("point".equals(endpoint.sourceType()) && endpoint.pointId() != null) {
            return "point:" + endpoint.pointId();
        }
        if (endpoint.lineId() == null || endpoint.endpointRole() == null || visited.contains(endpoint.endpointKey())) {
            return endpoint.endpointKey();
        }
        visited.add(endpoint.endpointKey());
        Optional<PipeLineDto> sourceLine = lines.stream().filter(line -> line.id().equals(endpoint.lineId())).findFirst();
        if (sourceLine.isEmpty()) {
            return endpoint.endpointKey();
        }
        PipeEndpointDto sourceEndpoint = "start".equals(endpoint.endpointRole()) ? sourceLine.get().start() : sourceLine.get().end();
        return resolveEndpointKey(sourceEndpoint, lines, visited);
    }

    private static String rounded(double value, int precision) {
        return String.format(Locale.ROOT, "%." + precision + "f", value);
    }

    private record MutableConnectionNode(String nodeKey, List<Vector3> positions, List<PipeConnectionBranchDto> branches) {
        MutableConnectionNode(String nodeKey) {
            this(nodeKey, new ArrayList<>(), new ArrayList<>());
        }
    }

    public record ConnectionNode(
        String id,
        String nodeKey,
        String pointId,
        PipeCoordinateDto position,
        int degree,
        List<String> connectionLineIds,
        String jointKind,
        String recommendedJointKind,
        List<PipeConnectionBranchDto> branches
    ) {
    }
}
