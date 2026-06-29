package com.example.pipeline.service;

import com.example.pipeline.api.dto.PipeBusinessTypeDto;
import com.example.pipeline.api.dto.PipeConnectionBranchDto;
import com.example.pipeline.api.dto.PipeConnectionDirectionDto;
import com.example.pipeline.api.dto.PipeCoordinateDto;
import com.example.pipeline.api.dto.PipeEndpointDto;
import com.example.pipeline.api.dto.PipeJointDto;
import com.example.pipeline.api.dto.PipeLayerDto;
import com.example.pipeline.api.dto.PipeLineDto;
import com.example.pipeline.api.dto.PipeModelOptionDto;
import com.example.pipeline.api.dto.PipePointDto;
import com.example.pipeline.api.dto.PipeShapeDto;
import com.example.pipeline.api.dto.ProjectDto;
import com.example.pipeline.domain.PipelineRules;
import com.example.pipeline.domain.PipelineTopology;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class PipelineReadService {
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public PipelineReadService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public long defaultProjectId() {
        return jdbcTemplate.queryForObject(
            "SELECT id FROM pipeline_project WHERE project_code = ?",
            Long.class,
            PipelineRules.DEFAULT_PROJECT_CODE
        );
    }

    public ProjectDto loadProject(long projectId) {
        return jdbcTemplate.queryForObject(
            "SELECT project_code, name, description FROM pipeline_project WHERE id = ?",
            (rs, rowNum) -> new ProjectDto(rs.getString("project_code"), rs.getString("name"), rs.getString("description")),
            projectId
        );
    }

    public List<PipeLayerDto> loadLayers(long projectId) {
        return jdbcTemplate.query(
            "SELECT layer_code, name, color, visible FROM pipe_layer WHERE project_id = ? ORDER BY id",
            (rs, rowNum) -> new PipeLayerDto(
                rs.getString("layer_code"),
                rs.getString("name"),
                rs.getString("color"),
                rs.getBoolean("visible")
            ),
            projectId
        );
    }

    public List<PipeBusinessTypeDto> loadBusinessTypes() {
        return jdbcTemplate.query(
            "SELECT id, name, color FROM pipe_business_type ORDER BY sort_order, id",
            (rs, rowNum) -> new PipeBusinessTypeDto(rs.getString("id"), rs.getString("name"), rs.getString("color"))
        );
    }

    public List<PipeModelOptionDto> loadModelOptions() {
        return jdbcTemplate.query(
            "SELECT id, name, description FROM pipe_model_style WHERE active = 1 ORDER BY id",
            (rs, rowNum) -> new PipeModelOptionDto(rs.getString("id"), rs.getString("name"), rs.getString("description"))
        );
    }

    public List<PipePointDto> loadPoints(long projectId) {
        return jdbcTemplate.query(
            """
            SELECT p.point_code, p.lon, p.lat, p.height, p.ground_height, p.relative_height, p.maishen,
                   l.layer_code, p.business_type_id, p.created_at, p.updated_at
            FROM pipe_point p
            JOIN pipe_layer l ON l.id = p.layer_id
            WHERE p.project_id = ?
            ORDER BY p.id
            """,
            (rs, rowNum) -> new PipePointDto(
                rs.getString("point_code"),
                rs.getDouble("lon"),
                rs.getDouble("lat"),
                rs.getDouble("height"),
                nullableDouble(rs, "ground_height"),
                rs.getDouble("relative_height"),
                rs.getDouble("maishen"),
                rs.getString("layer_code"),
                PipelineRules.normalizeBusinessType(rs.getString("business_type_id")),
                instantString(rs, "created_at"),
                instantString(rs, "updated_at")
            ),
            projectId
        );
    }

    public List<PipeLineDto> loadLines(long projectId) {
        return jdbcTemplate.query(
            """
            SELECT ln.line_code, ln.start_endpoint_json, ln.end_endpoint_json, sp.point_code AS start_point_code,
                   ep.point_code AS end_point_code, ly.layer_code, ln.business_type_id, ln.model_id,
                   ln.outer_radius_m, ln.wall_thickness_m, ln.flange_length_m, ln.flange_thickness_m,
                   ln.length_m, ln.connection_key, ln.detail_status, ln.detail_tileset_url,
                   ln.created_at, ln.updated_at
            FROM pipe_line ln
            JOIN pipe_layer ly ON ly.id = ln.layer_id
            LEFT JOIN pipe_point sp ON sp.id = ln.start_point_id
            LEFT JOIN pipe_point ep ON ep.id = ln.end_point_id
            WHERE ln.project_id = ?
            ORDER BY ln.id
            """,
            (rs, rowNum) -> mapLine(rs),
            projectId
        );
    }

    public List<PipeJointDto> loadJoints(long projectId, List<PipeLineDto> lines) {
        List<PipeJointDto> joints = jdbcTemplate.query(
            """
            SELECT frontend_joint_id, node_key, joint_kind, recommended_joint_kind, joint_label, manual_override,
                   center_lon, center_lat, center_height, degree, business_type_id, model_id, geometry_signature,
                   socket_signature, detail_status, detail_tileset_url, created_at, updated_at
            FROM pipe_joint
            WHERE project_id = ?
            ORDER BY id
            """,
            (rs, rowNum) -> mapJointShell(rs),
            projectId
        );
        List<PipeJointDto> filled = new ArrayList<>();
        for (PipeJointDto joint : joints) {
            List<PipeConnectionBranchDto> branches = loadJointBranches(projectId, joint.id());
            List<String> branchLineIds = branches.stream().map(PipeConnectionBranchDto::lineId).distinct().toList();
            filled.add(new PipeJointDto(
                joint.id(),
                joint.nodeId(),
                joint.nodeKey(),
                joint.pointId(),
                joint.jointKind(),
                joint.recommendedJointKind(),
                joint.jointLabel(),
                joint.manualOverride(),
                joint.position(),
                joint.degree(),
                branchLineIds,
                branches,
                branchLineIds,
                joint.businessTypeId(),
                joint.modelId(),
                joint.geometrySignature(),
                joint.socketSignature(),
                joint.detailModelStatus(),
                joint.detailTilesetUrl(),
                joint.createdAt(),
                joint.updatedAt()
            ));
        }
        return filled;
    }

    public PipeLineDto findLine(long projectId, String lineCode) {
        return loadLines(projectId).stream()
            .filter(line -> line.id().equals(lineCode))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("未找到管线 " + lineCode));
    }

    public PipeJointDto findJoint(long projectId, String jointId) {
        return loadJoints(projectId, loadLines(projectId)).stream()
            .filter(joint -> joint.id().equals(jointId))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("未找到连接点 " + jointId));
    }

    public List<PipeLineDto> allLines() {
        return loadLines(defaultProjectId());
    }

    public List<PipeJointDto> allJoints() {
        long projectId = defaultProjectId();
        return loadJoints(projectId, loadLines(projectId));
    }

    public List<PipeBusinessTypeDto> businessTypes() {
        return loadBusinessTypes();
    }

    private PipeLineDto mapLine(ResultSet rs) throws java.sql.SQLException {
        PipeEndpointDto start = readJson(rs.getString("start_endpoint_json"), PipeEndpointDto.class);
        PipeEndpointDto end = readJson(rs.getString("end_endpoint_json"), PipeEndpointDto.class);
        return new PipeLineDto(
            rs.getString("line_code"),
            "straight",
            start,
            end,
            rs.getString("start_point_code"),
            rs.getString("end_point_code"),
            rs.getString("layer_code"),
            PipelineRules.normalizeBusinessType(rs.getString("business_type_id")),
            PipelineRules.normalizeModelForBusiness(rs.getString("business_type_id"), rs.getString("model_id"), false),
            PipeShapeDto.circle(
                rs.getDouble("outer_radius_m"),
                rs.getDouble("wall_thickness_m"),
                rs.getDouble("flange_length_m"),
                rs.getDouble("flange_thickness_m")
            ),
            rs.getDouble("length_m"),
            rs.getString("connection_key"),
            rs.getString("detail_status"),
            rs.getString("detail_tileset_url"),
            instantString(rs, "created_at"),
            instantString(rs, "updated_at")
        );
    }

    private PipeJointDto mapJointShell(ResultSet rs) throws java.sql.SQLException {
        String nodeKey = rs.getString("node_key");
        return new PipeJointDto(
            rs.getString("frontend_joint_id"),
            PipelineTopology.makeNodeId(nodeKey),
            nodeKey,
            PipelineTopology.pointIdFromNodeKey(nodeKey),
            PipelineRules.normalizeJointKind(rs.getString("joint_kind")),
            PipelineRules.normalizeJointKind(rs.getString("recommended_joint_kind")),
            rs.getString("joint_label"),
            rs.getBoolean("manual_override"),
            new PipeCoordinateDto(rs.getDouble("center_lon"), rs.getDouble("center_lat"), rs.getDouble("center_height")),
            rs.getInt("degree"),
            List.of(),
            List.of(),
            List.of(),
            PipelineRules.normalizeBusinessType(rs.getString("business_type_id")),
            PipelineRules.normalizeModelForBusiness(rs.getString("business_type_id"), rs.getString("model_id"), false),
            rs.getString("geometry_signature"),
            rs.getString("socket_signature"),
            rs.getString("detail_status"),
            rs.getString("detail_tileset_url"),
            instantString(rs, "created_at"),
            instantString(rs, "updated_at")
        );
    }

    private List<PipeConnectionBranchDto> loadJointBranches(long projectId, String jointId) {
        return jdbcTemplate.query(
            """
            SELECT ln.line_code, jb.endpoint_role, jb.endpoint_key, jb.direction_x, jb.direction_y, jb.direction_z,
                   jb.outer_radius_m, jb.wall_thickness_m, jb.business_type_id
            FROM pipe_joint_branch jb
            JOIN pipe_joint j ON j.id = jb.joint_id
            JOIN pipe_line ln ON ln.id = jb.line_id
            WHERE j.project_id = ? AND j.frontend_joint_id = ?
            ORDER BY jb.id
            """,
            (rs, rowNum) -> new PipeConnectionBranchDto(
                rs.getString("line_code"),
                rs.getString("endpoint_role"),
                rs.getString("endpoint_key"),
                "straight",
                rs.getDouble("outer_radius_m"),
                rs.getDouble("wall_thickness_m"),
                PipelineRules.normalizeBusinessType(rs.getString("business_type_id")),
                new PipeConnectionDirectionDto(
                    rs.getDouble("direction_x"),
                    rs.getDouble("direction_y"),
                    rs.getDouble("direction_z")
                )
            ),
            projectId,
            jointId
        );
    }

    private <T> T readJson(String json, Class<T> type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (Exception error) {
            throw new IllegalArgumentException("JSON 解析失败", error);
        }
    }

    private String instantString(ResultSet rs, String column) throws java.sql.SQLException {
        Timestamp timestamp = rs.getTimestamp(column);
        return timestamp == null ? Instant.now().toString() : timestamp.toInstant().toString();
    }

    private Double nullableDouble(ResultSet rs, String column) throws java.sql.SQLException {
        double value = rs.getDouble(column);
        return rs.wasNull() ? null : value;
    }
}
