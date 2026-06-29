package com.example.pipeline.domain;

import com.example.pipeline.api.dto.PipeConnectionBranchDto;
import com.example.pipeline.api.dto.PipeJointDto;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class PipelineRules {
    public static final String DEFAULT_PROJECT_CODE = "default";
    public static final String DEFAULT_LAYER_CODE = "default";
    public static final String DEFAULT_BUSINESS_TYPE_ID = "water";
    public static final String DEFAULT_PIPE_MODEL_ID = "procedural-round";
    public static final double MIN_LINE_LENGTH_METERS = 0.01;
    public static final double IMPORT_HEIGHT_TOLERANCE_METERS = 0.01;
    public static final double STRAIGHT_ANGLE_THRESHOLD_DEGREES = 175.0;
    public static final String JOINT_GEOMETRY_VERSION = "joint-arc-demo-v5";
    public static final String FOUR_WAY_GEOMETRY_VERSION = "four-way-hub-spokes-v1";
    public static final String SOCKET_GEOMETRY_VERSION = "socket-cutback-v2";
    public static final Set<String> BUSINESS_TYPES = Set.of("water", "drainage", "gas");
    public static final Map<String, String> BUSINESS_NAME_TO_ID = Map.of(
        "\u7ed9\u6c34", "water",
        "\u6392\u6c34", "drainage",
        "\u71c3\u6c14", "gas"
    );
    public static final Map<String, List<String>> BUSINESS_MODEL_OPTIONS = Map.of(
        "water", List.of("ductile-iron-epoxy", "pipe-pp-pvc", "galvanized-steel", "coated-matte"),
        "drainage", List.of("frp-sand-pipe", "pipe-pp-pvc", "coated-matte"),
        "gas", List.of("hdpe-black-gas", "carbon-steel-new", "straight-9-metal", "carbon-steel-heavy-rust")
    );
    public static final Map<String, String> DEFAULT_MODEL_BY_BUSINESS = Map.of(
        "water", "ductile-iron-epoxy",
        "drainage", "frp-sand-pipe",
        "gas", "hdpe-black-gas"
    );
    public static final Map<String, String> JOINT_LABELS = Map.of(
        "terminal", "\u7aef\u70b9",
        "straight", "\u4e00\u5b57\u76f4\u901a",
        "uBend", "\u5e73\u6ed1\u5706\u5f2f\u8fde\u63a5\u5934",
        "threeWay", "\u5e73\u6ed1\u878d\u5408\u4e09\u901a",
        "fourWay", "\u5e73\u6ed1\u878d\u5408\u56db\u901a",
        "multi", "\u591a\u901a\u8282\u70b9"
    );

    private PipelineRules() {
    }

    public static String normalizeBusinessType(String value) {
        String trimmed = trim(value);
        if (trimmed.isEmpty() || "default".equals(trimmed) || "sewage".equals(trimmed)) {
            return DEFAULT_BUSINESS_TYPE_ID;
        }
        String translated = BUSINESS_NAME_TO_ID.getOrDefault(trimmed, trimmed);
        if (!BUSINESS_TYPES.contains(translated)) {
            throw new IllegalArgumentException("\u975e\u6cd5\u4e1a\u52a1\u7c7b\u578b: " + value);
        }
        return translated;
    }

    public static String normalizeModelForBusiness(String businessTypeId, String modelId, boolean strictExplicit) {
        String normalizedBusinessTypeId = normalizeBusinessType(businessTypeId);
        String trimmedModelId = trim(modelId);
        if (trimmedModelId.isEmpty() || DEFAULT_PIPE_MODEL_ID.equals(trimmedModelId)) {
            return DEFAULT_MODEL_BY_BUSINESS.getOrDefault(normalizedBusinessTypeId, DEFAULT_MODEL_BY_BUSINESS.get("water"));
        }
        List<String> allowed = BUSINESS_MODEL_OPTIONS.getOrDefault(normalizedBusinessTypeId, BUSINESS_MODEL_OPTIONS.get("water"));
        if (allowed.contains(trimmedModelId)) {
            return trimmedModelId;
        }
        if (strictExplicit) {
            throw new IllegalArgumentException("\u6a21\u578b\u98ce\u683c " + trimmedModelId + " \u4e0d\u5c5e\u4e8e\u4e1a\u52a1\u7c7b\u578b " + normalizedBusinessTypeId);
        }
        return DEFAULT_MODEL_BY_BUSINESS.getOrDefault(normalizedBusinessTypeId, DEFAULT_MODEL_BY_BUSINESS.get("water"));
    }

    public static String normalizeJointKind(String jointKind) {
        if (jointKind == null) {
            return "multi";
        }
        return switch (jointKind) {
            case "cross", "demoCross", "demoFourWay" -> "fourWay";
            case "demoThreeWay" -> "threeWay";
            case "elbow" -> "uBend";
            case "terminal", "straight", "uBend", "threeWay", "fourWay", "multi" -> jointKind;
            default -> "multi";
        };
    }

    public static List<String> allowedJointKinds(int degree) {
        if (degree == 2) {
            return List.of("straight", "uBend");
        }
        if (degree == 3) {
            return List.of("threeWay");
        }
        if (degree == 4) {
            return List.of("fourWay");
        }
        return List.of();
    }

    public static String jointLabel(String jointKind) {
        return JOINT_LABELS.getOrDefault(jointKind, jointKind);
    }

    public static double jointOuterRadius(PipeJointDto joint) {
        return Math.max(0.28, joint.branches().stream().mapToDouble(PipeConnectionBranchDto::outerRadius).max().orElse(0.28));
    }

    public static double jointSocketLength(PipeJointDto joint) {
        return effectiveJointBranchLength(joint.jointKind(), joint.degree(), jointOuterRadius(joint));
    }

    public static double effectiveJointBranchLength(String jointKind, int degree, double outerRadius) {
        if ("uBend".equals(jointKind)) {
            return Math.max(outerRadius * 5.8, 1.8);
        }
        if ("threeWay".equals(jointKind)) {
            return Math.max(outerRadius * 5.8, 1.8) * 0.6;
        }
        if ("fourWay".equals(jointKind)) {
            return Math.max(outerRadius * 1.8, 0.75);
        }
        if (degree <= 2) {
            return Math.max(outerRadius * 3.2, 1.0);
        }
        return Math.max(outerRadius * 4.2, 1.4);
    }

    public static String geometryVersion(String jointKind) {
        return "fourWay".equals(jointKind)
            ? JOINT_GEOMETRY_VERSION + ":" + FOUR_WAY_GEOMETRY_VERSION
            : JOINT_GEOMETRY_VERSION;
    }

    public static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
