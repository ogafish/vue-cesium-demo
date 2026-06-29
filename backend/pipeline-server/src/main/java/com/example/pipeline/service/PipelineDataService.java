package com.example.pipeline.service;

import com.example.pipeline.api.dto.CreateLineRequest;
import com.example.pipeline.api.dto.CreatePointRequest;
import com.example.pipeline.api.dto.ImportCommitRequest;
import com.example.pipeline.api.dto.ImportErrorDto;
import com.example.pipeline.api.dto.ImportPreviewDto;
import com.example.pipeline.api.dto.PipeBusinessTypeDto;
import com.example.pipeline.api.dto.PipeConnectionBranchDto;
import com.example.pipeline.api.dto.PipeEndpointDto;
import com.example.pipeline.api.dto.PipeJointDto;
import com.example.pipeline.api.dto.PipeLayerDto;
import com.example.pipeline.api.dto.PipeLineDto;
import com.example.pipeline.api.dto.PipeModelOptionDto;
import com.example.pipeline.api.dto.PipePointDto;
import com.example.pipeline.api.dto.PipeShapeDto;
import com.example.pipeline.api.dto.PipelineBootstrapDto;
import com.example.pipeline.api.dto.PipelineMutationDto;
import com.example.pipeline.api.dto.ProjectDto;
import com.example.pipeline.api.dto.UpdateJointKindRequest;
import com.example.pipeline.api.dto.UpdateJointModelRequest;
import com.example.pipeline.api.dto.UpdateLineModelRequest;
import com.example.pipeline.domain.GeoMath;
import com.example.pipeline.domain.PipelineRules;
import com.example.pipeline.domain.PipelineTopology;
import com.example.pipeline.domain.PipelineTopology.ConnectionNode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.opencsv.CSVReaderHeaderAware;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class PipelineDataService {
    private static final String DEFAULT_LAYER_CODE = PipelineRules.DEFAULT_LAYER_CODE;
    private static final double MIN_LINE_LENGTH_METERS = PipelineRules.MIN_LINE_LENGTH_METERS;
    private static final double IMPORT_HEIGHT_TOLERANCE_METERS = PipelineRules.IMPORT_HEIGHT_TOLERANCE_METERS;
    private static final Map<String, String> DEFAULT_MODEL_BY_BUSINESS = PipelineRules.DEFAULT_MODEL_BY_BUSINESS;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final PipelineReadService readService;

    public PipelineDataService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper, PipelineReadService readService) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.readService = readService;
    }

    private PipelineBootstrapDto bootstrap() {
        long projectId = defaultProjectId();
        rebuildTopology(projectId);

        List<PipeLayerDto> layers = loadLayers(projectId);
        List<PipeBusinessTypeDto> businessTypes = loadBusinessTypes();
        List<PipeModelOptionDto> modelOptions = loadModelOptions();
        List<PipePointDto> points = loadPoints(projectId);
        List<PipeLineDto> lines = loadLines(projectId);
        List<PipeJointDto> joints = loadJoints(projectId, lines);
        List<String> tilesetUrls = new ArrayList<>();
        lines.stream().map(PipeLineDto::detailTilesetUrl).filter(Objects::nonNull).forEach(tilesetUrls::add);
        joints.stream().map(PipeJointDto::detailTilesetUrl).filter(Objects::nonNull).forEach(tilesetUrls::add);

        return new PipelineBootstrapDto(
            loadProject(projectId),
            layers,
            businessTypes,
            modelOptions,
            PipelineRules.BUSINESS_MODEL_OPTIONS,
            PipelineRules.DEFAULT_MODEL_BY_BUSINESS,
            points,
            lines,
            joints,
            tilesetUrls
        );
    }

    @Transactional
    public PipelineMutationDto createPoint(CreatePointRequest request) {
        long projectId = defaultProjectId();
        validateCoordinate(request.lon(), request.lat(), request.height(), "管点坐标");
        long layerDbId = layerDbId(projectId, blankToDefault(request.layerId(), DEFAULT_LAYER_CODE));
        String businessTypeId = normalizeBusinessType(request.businessTypeId());
        String pointCode = nextCode(projectId, "pipe_point", "point_code", "P", 4);
        double relativeHeight = request.relativeHeight() != null ? request.relativeHeight() : 0;
        double maishen = request.maishen() != null ? request.maishen() : 0;

        jdbcTemplate.update(
            """
            INSERT INTO pipe_point(project_id, point_code, lon, lat, height, ground_height, relative_height, maishen,
                                   layer_id, business_type_id, geom, attrs_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, POINT(?, ?), JSON_OBJECT())
            """,
            projectId,
            pointCode,
            request.lon(),
            request.lat(),
            request.height(),
            request.groundHeight(),
            relativeHeight,
            maishen,
            layerDbId,
            businessTypeId,
            request.lon(),
            request.lat()
        );

        return new PipelineMutationDto("point", pointCode, bootstrap());
    }

    @Transactional
    public PipelineMutationDto deletePoint(String pointCode) {
        long projectId = defaultProjectId();
        long pointDbId = pointDbId(projectId, pointCode);
        Integer linkedCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM pipe_line WHERE project_id = ? AND (start_point_id = ? OR end_point_id = ?)",
            Integer.class,
            projectId,
            pointDbId,
            pointDbId
        );
        if (linkedCount != null && linkedCount > 0) {
            throw new IllegalArgumentException("管点 " + pointCode + " 已被管线引用，请先删除关联管线");
        }
        jdbcTemplate.update("DELETE FROM pipe_point WHERE project_id = ? AND id = ?", projectId, pointDbId);
        return new PipelineMutationDto("point", pointCode, bootstrap());
    }

    @Transactional
    public PipelineMutationDto createLine(CreateLineRequest request) {
        long projectId = defaultProjectId();
        List<PipeLineDto> existingLines = loadLines(projectId);
        String businessTypeId = normalizeBusinessType(request.businessTypeId());
        PipeShapeDto shape = normalizeShape(request.shape());
        validateLineDraft(request.start(), request.end(), existingLines, businessTypeId, null);
        String modelId = normalizeModelForBusiness(businessTypeId, request.modelId(), false);
        String lineCode = nextCode(projectId, "pipe_line", "line_code", "L", 4);
        String connectionKey = buildConnectionKey(request.start(), request.end(), existingLines);
        long layerDbId = layerDbId(projectId, blankToDefault(request.layerId(), DEFAULT_LAYER_CODE));
        Long startPointDbId = endpointPointDbId(projectId, request.start());
        Long endPointDbId = endpointPointDbId(projectId, request.end());
        double length = distanceMeters(request.start(), request.end());

        jdbcTemplate.update(
            """
            INSERT INTO pipe_line(project_id, line_code, start_point_id, end_point_id, start_endpoint_json, end_endpoint_json,
                                  start_lon, start_lat, start_height, end_lon, end_lat, end_height, layer_id,
                                  business_type_id, model_id, shape_type, outer_radius_m, wall_thickness_m,
                                  flange_length_m, flange_thickness_m, length_m, connection_key, detail_status, attrs_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'circle', ?, ?, ?, ?, ?, ?, 'none', JSON_OBJECT())
            """,
            projectId,
            lineCode,
            startPointDbId,
            endPointDbId,
            writeJson(request.start()),
            writeJson(request.end()),
            request.start().lon(),
            request.start().lat(),
            request.start().height(),
            request.end().lon(),
            request.end().lat(),
            request.end().height(),
            layerDbId,
            businessTypeId,
            modelId,
            shape.radius(),
            shape.thickness(),
            shape.flangeLength(),
            shape.flangeThickness(),
            length,
            connectionKey
        );

        rebuildTopology(projectId);
        return new PipelineMutationDto("line", lineCode, bootstrap());
    }

    @Transactional
    public PipelineMutationDto deleteLine(String lineCode) {
        long projectId = defaultProjectId();
        Long lineDbId = nullableLineDbId(projectId, lineCode);
        if (lineDbId == null) {
            throw new IllegalArgumentException("未找到管线 " + lineCode);
        }
        List<PipeLineDto> lines = loadLines(projectId);
        for (PipeLineDto line : lines) {
            if (line.id().equals(lineCode)) {
                continue;
            }
            if (endpointReferencesLine(line.start(), lineCode) || endpointReferencesLine(line.end(), lineCode)) {
                throw new IllegalArgumentException("管线 " + lineCode + " 的端点被管线 " + line.id() + " 引用，请先删除依赖管线");
            }
        }
        jdbcTemplate.update("DELETE FROM pipe_line WHERE project_id = ? AND line_code = ?", projectId, lineCode);
        rebuildTopology(projectId);
        return new PipelineMutationDto("line", lineCode, bootstrap());
    }

    @Transactional
    public PipelineMutationDto updateLineModel(String lineCode, UpdateLineModelRequest request) {
        long projectId = defaultProjectId();
        PipeLineDto line = findLine(projectId, lineCode);
        double radius = requirePositive(request.radius(), "外半径");
        double thickness = requirePositive(request.thickness(), "壁厚");
        if (thickness >= radius) {
            throw new IllegalArgumentException("壁厚必须小于外半径");
        }
        String businessTypeId = normalizeBusinessType(request.businessTypeId());
        ensureLineBusinessCanChange(line, loadLines(projectId), businessTypeId);
        String modelId = normalizeModelForBusiness(businessTypeId, request.modelId(), false);
        String status = line.detailTilesetUrl() != null ? "dirty" : line.detailModelStatus();

        jdbcTemplate.update(
            """
            UPDATE pipe_line
            SET business_type_id = ?, model_id = ?, outer_radius_m = ?, wall_thickness_m = ?,
                detail_status = ?, updated_at = CURRENT_TIMESTAMP(3)
            WHERE project_id = ? AND line_code = ?
            """,
            businessTypeId,
            modelId,
            radius,
            thickness,
            status,
            projectId,
            lineCode
        );
        rebuildTopology(projectId);
        return new PipelineMutationDto("line", lineCode, bootstrap());
    }

    @Transactional
    public PipelineMutationDto updateJointKind(String jointId, UpdateJointKindRequest request) {
        long projectId = defaultProjectId();
        String normalizedKind = normalizeJointKind(request.jointKind());
        PipeJointDto joint = findJoint(projectId, jointId);
        if (!allowedJointKinds(joint.degree()).contains(normalizedKind)) {
            throw new IllegalArgumentException("连接点类型不适用于 " + joint.degree() + " 条管线的连接点");
        }
        String geometrySignature = makeJointGeometrySignature(joint, normalizedKind, joint.businessTypeId(), joint.modelId());
        jdbcTemplate.update(
            """
            UPDATE pipe_joint
            SET joint_kind = ?, joint_label = ?, manual_override = ?, geometry_signature = ?,
                detail_status = 'dirty', updated_at = CURRENT_TIMESTAMP(3)
            WHERE project_id = ? AND frontend_joint_id = ?
            """,
            normalizedKind,
            jointLabel(normalizedKind),
            !normalizedKind.equals(joint.recommendedJointKind()),
            geometrySignature,
            projectId,
            jointId
        );
        return new PipelineMutationDto("joint", jointId, bootstrap());
    }

    @Transactional
    public PipelineMutationDto updateJointModel(String jointId, UpdateJointModelRequest request) {
        long projectId = defaultProjectId();
        PipeJointDto joint = findJoint(projectId, jointId);
        String businessTypeId = normalizeBusinessType(request.businessTypeId());
        Set<String> branchBusinessTypes = joint.branches().stream()
            .map(PipeConnectionBranchDto::businessTypeId)
            .map(this::normalizeBusinessType)
            .collect(Collectors.toSet());
        if (!branchBusinessTypes.contains(businessTypeId)) {
            throw new IllegalArgumentException("连接管业务类型必须来自相连管线");
        }
        String modelId = normalizeModelForBusiness(businessTypeId, request.modelId(), false);
        String geometrySignature = makeJointGeometrySignature(joint, joint.jointKind(), businessTypeId, modelId);
        jdbcTemplate.update(
            """
            UPDATE pipe_joint
            SET business_type_id = ?, model_id = ?, geometry_signature = ?,
                detail_status = 'dirty', updated_at = CURRENT_TIMESTAMP(3)
            WHERE project_id = ? AND frontend_joint_id = ?
            """,
            businessTypeId,
            modelId,
            geometrySignature,
            projectId,
            jointId
        );
        return new PipelineMutationDto("joint", jointId, bootstrap());
    }

    @Transactional
    public ImportPreviewDto previewExcel(MultipartFile file) {
        try (Workbook workbook = new XSSFWorkbook(file.getInputStream())) {
            List<Map<String, String>> points = readSheet(workbook.getSheet("points"));
            List<Map<String, String>> lines = readSheet(workbook.getSheet("lines"));
            return createImportJob("xlsx", points, lines);
        } catch (Exception error) {
            throw new IllegalArgumentException("Excel 导入解析失败：" + error.getMessage(), error);
        }
    }

    @Transactional
    public ImportPreviewDto previewCsv(MultipartFile pointsFile, MultipartFile linesFile) {
        try {
            List<Map<String, String>> points = readCsv(pointsFile);
            List<Map<String, String>> lines = readCsv(linesFile);
            return createImportJob("csv", points, lines);
        } catch (Exception error) {
            throw new IllegalArgumentException("CSV 导入解析失败：" + error.getMessage(), error);
        }
    }

    @Transactional
    public PipelineMutationDto commitImport(long jobId, ImportCommitRequest request) {
        long projectId = defaultProjectId();
        ImportStorage storage = loadImportStorage(jobId);
        List<ImportErrorDto> errors = validateImport(storage.points(), storage.lines(), projectId);
        if (!errors.isEmpty()) {
            replaceImportErrors(jobId, errors);
            jdbcTemplate.update(
                "UPDATE pipe_import_job SET status = 'invalid', error_count = ?, message = '存在校验错误，未写入正式数据' WHERE id = ?",
                errors.size(),
                jobId
            );
            throw new IllegalArgumentException("导入数据仍存在错误，已阻止写入");
        }

        String mode = request.mode() == null ? "append" : request.mode();
        if ("replace".equalsIgnoreCase(mode) || "clear".equalsIgnoreCase(mode)) {
            clearProjectBusinessData(projectId);
        }

        Map<String, Long> pointDbIds = new HashMap<>();
        Map<String, PipePointDto> existingPoints = loadPoints(projectId).stream()
            .collect(Collectors.toMap(PipePointDto::id, point -> point, (first, second) -> first));
        for (Map<String, String> pointRow : storage.points()) {
            String code = requiredText(pointRow, "point_code", "points", 0);
            if (existingPoints.containsKey(code)) {
                throw new IllegalArgumentException("管点编码已存在：" + code);
            }
            double lon = parseNumber(pointRow.get("lon"), "lon");
            double lat = parseNumber(pointRow.get("lat"), "lat");
            ImportPointHeight heightInfo = resolveImportPointHeight(pointRow);
            String businessTypeId = normalizeBusinessType(pointRow.get("business_type"));
            long layerDbId = layerDbId(projectId, blankToDefault(pointRow.get("layer_code"), DEFAULT_LAYER_CODE));
            long pointId = insertAndReturnId(
                """
                INSERT INTO pipe_point(project_id, point_code, lon, lat, height, ground_height, relative_height, maishen,
                                       layer_id, business_type_id, geom, attrs_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, POINT(?, ?), ?)
                """,
                statement -> {
                    statement.setLong(1, projectId);
                    statement.setString(2, code);
                    statement.setDouble(3, lon);
                    statement.setDouble(4, lat);
                    statement.setDouble(5, heightInfo.height());
                    if (heightInfo.groundHeight() == null) {
                        statement.setObject(6, null);
                    } else {
                        statement.setDouble(6, heightInfo.groundHeight());
                    }
                    statement.setDouble(7, heightInfo.relativeHeight());
                    statement.setDouble(8, heightInfo.maishen());
                    statement.setLong(9, layerDbId);
                    statement.setString(10, businessTypeId);
                    statement.setDouble(11, lon);
                    statement.setDouble(12, lat);
                    statement.setString(13, writeJson(importAttrs(pointRow)));
                }
            );
            pointDbIds.put(code, pointId);
        }

        Map<String, PipePointDto> allPoints = loadPoints(projectId).stream()
            .collect(Collectors.toMap(PipePointDto::id, point -> point, (first, second) -> first));
        List<PipeLineDto> currentLines = new ArrayList<>(loadLines(projectId));
        for (Map<String, String> lineRow : storage.lines()) {
            String lineCode = requiredText(lineRow, "line_code", "lines", 0);
            String startCode = requiredText(lineRow, "start_point_code", "lines", 0);
            String endCode = requiredText(lineRow, "end_point_code", "lines", 0);
            PipePointDto startPoint = allPoints.get(startCode);
            PipePointDto endPoint = allPoints.get(endCode);
            String businessTypeId = normalizeBusinessType(lineRow.get("business_type"));
            String modelId = normalizeModelForBusiness(businessTypeId, lineRow.get("model_id"), true);
            double outerRadius = parseNumber(lineRow.get("outer_diameter_mm"), "outer_diameter_mm") / 2000.0;
            double wallThickness = parseNumber(lineRow.get("wall_thickness_mm"), "wall_thickness_mm") / 1000.0;
            PipeEndpointDto start = endpointFromPoint(startPoint);
            PipeEndpointDto end = endpointFromPoint(endPoint);
            String connectionKey = buildConnectionKey(start, end, currentLines);
            long layerDbId = layerDbId(projectId, blankToDefault(lineRow.get("layer_code"), DEFAULT_LAYER_CODE));
            Long startDbId = pointDbIds.get(startCode);
            if (startDbId == null) {
                startDbId = pointDbId(projectId, startCode);
            }
            Long endDbId = pointDbIds.get(endCode);
            if (endDbId == null) {
                endDbId = pointDbId(projectId, endCode);
            }
            double length = distanceMeters(start, end);
            jdbcTemplate.update(
                """
                INSERT INTO pipe_line(project_id, line_code, start_point_id, end_point_id, start_endpoint_json, end_endpoint_json,
                                      start_lon, start_lat, start_height, end_lon, end_lat, end_height, layer_id,
                                      business_type_id, model_id, shape_type, outer_radius_m, wall_thickness_m,
                                      flange_length_m, flange_thickness_m, length_m, connection_key, detail_status, attrs_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'circle', ?, ?, 0, 0, ?, ?, 'none', ?)
                """,
                projectId,
                lineCode,
                startDbId,
                endDbId,
                writeJson(start),
                writeJson(end),
                start.lon(),
                start.lat(),
                start.height(),
                end.lon(),
                end.lat(),
                end.height(),
                layerDbId,
                businessTypeId,
                modelId,
                outerRadius,
                wallThickness,
                length,
                connectionKey,
                writeJson(importAttrs(lineRow))
            );
            currentLines = loadLines(projectId);
        }

        rebuildTopology(projectId);
        jdbcTemplate.update(
            "UPDATE pipe_import_job SET status = 'committed', mode = ?, auto_generate = ?, message = '导入已提交', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
            mode,
            Boolean.TRUE.equals(request.autoGenerate()),
            jobId
        );
        return new PipelineMutationDto("import", String.valueOf(jobId), bootstrap());
    }

    private ImportPreviewDto createImportJob(String fileType, List<Map<String, String>> points, List<Map<String, String>> lines) {
        long projectId = defaultProjectId();
        List<ImportErrorDto> errors = validateImport(points, lines, projectId);
        ImportStorage storage = new ImportStorage(points, lines);
        long jobId = insertAndReturnId(
            """
            INSERT INTO pipe_import_job(project_id, file_type, status, mapping_json, preview_json, total_points, total_lines, error_count, message)
            VALUES (?, ?, ?, JSON_OBJECT(), ?, ?, ?, ?, ?)
            """,
            statement -> {
                statement.setLong(1, projectId);
                statement.setString(2, fileType);
                statement.setString(3, errors.isEmpty() ? "preview_valid" : "invalid");
                statement.setString(4, writeJson(storage));
                statement.setInt(5, points.size());
                statement.setInt(6, lines.size());
                statement.setInt(7, errors.size());
                statement.setString(8, errors.isEmpty() ? "预览校验通过" : "预览存在校验错误");
            }
        );
        replaceImportErrors(jobId, errors);
        return new ImportPreviewDto(
            jobId,
            errors.isEmpty() ? "preview_valid" : "invalid",
            points.size(),
            lines.size(),
            errors.size(),
            new ArrayList<>(points.stream().limit(50).map(row -> new LinkedHashMap<String, Object>(row)).toList()),
            new ArrayList<>(lines.stream().limit(50).map(row -> new LinkedHashMap<String, Object>(row)).toList()),
            errors
        );
    }

    private List<ImportErrorDto> validateImport(List<Map<String, String>> points, List<Map<String, String>> lines, long projectId) {
        List<ImportErrorDto> errors = new ArrayList<>();
        Map<String, Map<String, String>> importedPoints = new LinkedHashMap<>();
        Set<String> pointCodes = new HashSet<>();
        int rowNumber = 1;
        for (Map<String, String> row : points) {
            rowNumber += 1;
            String pointCode = trim(row.get("point_code"));
            if (pointCode.isEmpty()) {
                errors.add(new ImportErrorDto("points", rowNumber, "point_code", "管点编码不能为空"));
                continue;
            }
            if (!pointCodes.add(pointCode)) {
                errors.add(new ImportErrorDto("points", rowNumber, "point_code", "管点编码重复：" + pointCode));
            }
            importedPoints.put(pointCode, row);
            validateRequiredNumber(errors, "points", rowNumber, row, "lon");
            validateRequiredNumber(errors, "points", rowNumber, row, "lat");
            try {
                double lon = parseNumber(row.get("lon"), "lon");
                double lat = parseNumber(row.get("lat"), "lat");
                ImportPointHeight heightInfo = resolveImportPointHeight(row);
                validateCoordinate(lon, lat, heightInfo.height(), "points 第 " + rowNumber + " 行");
            } catch (Exception error) {
                errors.add(new ImportErrorDto("points", rowNumber, "coordinate", error.getMessage()));
            }
            try {
                normalizeBusinessType(row.get("business_type"));
            } catch (Exception error) {
                errors.add(new ImportErrorDto("points", rowNumber, "business_type", error.getMessage()));
            }
        }

        Map<String, PipePointDto> existingPoints = loadPoints(projectId).stream()
            .collect(Collectors.toMap(PipePointDto::id, point -> point, (first, second) -> first));
        Map<String, PipeLineDto> existingLines = loadLines(projectId).stream()
            .collect(Collectors.toMap(PipeLineDto::id, line -> line, (first, second) -> first));
        Set<String> lineCodes = new HashSet<>();
        Set<String> importedConnectionKeys = new HashSet<>();
        Map<String, Set<String>> businessByPoint = new HashMap<>();
        rowNumber = 1;
        for (Map<String, String> row : lines) {
            rowNumber += 1;
            String lineCode = trim(row.get("line_code"));
            String startCode = trim(row.get("start_point_code"));
            String endCode = trim(row.get("end_point_code"));
            if (lineCode.isEmpty()) {
                errors.add(new ImportErrorDto("lines", rowNumber, "line_code", "管线编码不能为空"));
            } else if (!lineCodes.add(lineCode) || existingLines.containsKey(lineCode)) {
                errors.add(new ImportErrorDto("lines", rowNumber, "line_code", "管线编码重复或已存在：" + lineCode));
            }
            if (startCode.isEmpty()) {
                errors.add(new ImportErrorDto("lines", rowNumber, "start_point_code", "起点编码不能为空"));
            }
            if (endCode.isEmpty()) {
                errors.add(new ImportErrorDto("lines", rowNumber, "end_point_code", "终点编码不能为空"));
            }
            if (startCode.equals(endCode) && !startCode.isEmpty()) {
                errors.add(new ImportErrorDto("lines", rowNumber, "end_point_code", "起点和终点不能相同"));
            }
            if (!importedPoints.containsKey(startCode) && !existingPoints.containsKey(startCode)) {
                errors.add(new ImportErrorDto("lines", rowNumber, "start_point_code", "起点管点不存在：" + startCode));
            }
            if (!importedPoints.containsKey(endCode) && !existingPoints.containsKey(endCode)) {
                errors.add(new ImportErrorDto("lines", rowNumber, "end_point_code", "终点管点不存在：" + endCode));
            }
            String businessTypeId = null;
            try {
                businessTypeId = normalizeBusinessType(row.get("business_type"));
            } catch (Exception error) {
                errors.add(new ImportErrorDto("lines", rowNumber, "business_type", error.getMessage()));
            }
            validateRequiredNumber(errors, "lines", rowNumber, row, "outer_diameter_mm");
            validateRequiredNumber(errors, "lines", rowNumber, row, "wall_thickness_mm");
            try {
                double radius = parseNumber(row.get("outer_diameter_mm"), "outer_diameter_mm") / 2000.0;
                double thickness = parseNumber(row.get("wall_thickness_mm"), "wall_thickness_mm") / 1000.0;
                if (radius <= 0 || thickness <= 0 || thickness >= radius) {
                    errors.add(new ImportErrorDto("lines", rowNumber, "wall_thickness_mm", "管径/壁厚非法，壁厚必须小于外半径"));
                }
            } catch (Exception ignored) {
                // Required number validation already added the field-level error.
            }
            if (businessTypeId != null) {
                try {
                    normalizeModelForBusiness(businessTypeId, row.get("model_id"), true);
                } catch (Exception error) {
                    errors.add(new ImportErrorDto("lines", rowNumber, "model_id", error.getMessage()));
                }
                if (!startCode.isEmpty()) {
                    businessByPoint.computeIfAbsent(startCode, key -> new HashSet<>()).add(businessTypeId);
                }
                if (!endCode.isEmpty()) {
                    businessByPoint.computeIfAbsent(endCode, key -> new HashSet<>()).add(businessTypeId);
                }
            }
            if (!startCode.isEmpty() && !endCode.isEmpty()) {
                String key = List.of(startCode, endCode).stream().sorted().collect(Collectors.joining("|"));
                if (!importedConnectionKeys.add(key)) {
                    errors.add(new ImportErrorDto("lines", rowNumber, "connection", "导入表内存在重复连接：" + key));
                }
            }
        }

        for (Map.Entry<String, Set<String>> entry : businessByPoint.entrySet()) {
            if (entry.getValue().size() > 1) {
                errors.add(new ImportErrorDto("lines", 0, "business_type", "同一管点混入不同业务管线：" + entry.getKey()));
            }
        }
        return errors;
    }

    private void replaceImportErrors(long jobId, List<ImportErrorDto> errors) {
        jdbcTemplate.update("DELETE FROM pipe_import_error_row WHERE job_id = ?", jobId);
        for (ImportErrorDto error : errors) {
            jdbcTemplate.update(
                """
                INSERT INTO pipe_import_error_row(job_id, sheet_name, row_number, field_name, raw_json, message)
                VALUES (?, ?, ?, ?, JSON_OBJECT(), ?)
                """,
                jobId,
                error.sheetName(),
                error.rowNumber(),
                error.fieldName(),
                error.message()
            );
        }
    }

    private void validateLineDraft(
        PipeEndpointDto start,
        PipeEndpointDto end,
        List<PipeLineDto> lines,
        String businessTypeId,
        String ignoreLineId
    ) {
        if (start == null) {
            throw new IllegalArgumentException("请选择管线起点");
        }
        if (end == null) {
            throw new IllegalArgumentException("请选择管线终点");
        }
        if (Objects.equals(start.endpointKey(), end.endpointKey())) {
            throw new IllegalArgumentException("起点和终点不能是同一个端点");
        }
        if (distanceMeters(start, end) < MIN_LINE_LENGTH_METERS) {
            throw new IllegalArgumentException("起点和终点距离过近，无法生成管线");
        }
        EndpointBusinessResolution startBusiness = endpointBusiness(start, lines, ignoreLineId);
        EndpointBusinessResolution endBusiness = endpointBusiness(end, lines, ignoreLineId);
        if (startBusiness.mixed() || endBusiness.mixed()) {
            throw new IllegalArgumentException("端点已关联多个业务类型的管线，无法继续连接");
        }
        String startBusinessId = startBusiness.singleBusinessTypeId();
        String endBusinessId = endBusiness.singleBusinessTypeId();
        if (startBusinessId != null && endBusinessId != null && !startBusinessId.equals(endBusinessId)) {
            throw new IllegalArgumentException("不同业务类型的管线不能连接");
        }
        String connectedBusinessId = startBusinessId != null ? startBusinessId : endBusinessId;
        if (connectedBusinessId != null && !connectedBusinessId.equals(businessTypeId)) {
            throw new IllegalArgumentException("草稿业务类型与已连接管线不一致，无法生成管线");
        }
        String connectionKey = buildConnectionKey(start, end, lines);
        boolean duplicate = lines.stream()
            .anyMatch(line -> !line.id().equals(ignoreLineId) && line.connectionKey().equals(connectionKey));
        if (duplicate) {
            throw new IllegalArgumentException("两个端点之间已存在管线");
        }
    }

    @Transactional
    public void rebuildTopology(long projectId) {
        List<PipeLineDto> lines = loadLines(projectId);
        List<PipeJointDto> previousJoints = loadJoints(projectId, lines);
        Map<String, PipeJointDto> previousByNodeKey = previousJoints.stream()
            .collect(Collectors.toMap(PipeJointDto::nodeKey, joint -> joint, (first, second) -> first));
        List<ConnectionNode> nodes = PipelineTopology.buildConnectionNodes(lines);
        Set<String> nextNodeKeys = new HashSet<>();

        for (ConnectionNode node : nodes) {
            if ("terminal".equals(node.jointKind())) {
                continue;
            }
            nextNodeKeys.add(node.nodeKey());
            PipeJointDto previous = previousByNodeKey.get(node.nodeKey());
            List<String> allowedKinds = allowedJointKinds(node.degree());
            String previousKind = normalizeJointKind(previous == null ? null : previous.jointKind());
            boolean keepManual = previous != null && previous.manualOverride() && allowedKinds.contains(previousKind);
            String jointKind = keepManual ? previousKind : node.jointKind();
            String businessTypeId = normalizeBusinessType(previous == null ? node.branches().get(0).businessTypeId() : previous.businessTypeId());
            String modelId = normalizeModelForBusiness(
                businessTypeId,
                previous == null ? DEFAULT_MODEL_BY_BUSINESS.get(businessTypeId) : previous.modelId(),
                false
            );
            ConnectionNode effectiveNode = new ConnectionNode(
                node.id(),
                node.nodeKey(),
                node.pointId(),
                node.position(),
                node.degree(),
                node.connectionLineIds(),
                jointKind,
                node.recommendedJointKind(),
                node.branches()
            );
            String geometrySignature = makeJointGeometrySignature(node, jointKind, businessTypeId, modelId);
            String socketSignature = makeJointSocketSignature(effectiveNode);
            boolean keepLoaded = previous != null
                && previous.geometrySignature().equals(geometrySignature)
                && previous.socketSignature().equals(socketSignature)
                && ("loaded".equals(previous.detailModelStatus()) || "generating".equals(previous.detailModelStatus()))
                && previous.detailTilesetUrl() != null;
            String detailStatus = keepLoaded
                ? previous.detailModelStatus()
                : (previous != null && previous.detailTilesetUrl() != null ? "dirty" : "none");
            String detailUrl = previous == null ? null : previous.detailTilesetUrl();
            String frontendJointId = makeJointId(node.id());

            long jointDbId;
            if (previous == null) {
                markBranchLinesDirty(projectId, node.branches());
                jointDbId = insertAndReturnId(
                    """
                    INSERT INTO pipe_joint(project_id, node_key, frontend_joint_id, joint_kind, recommended_joint_kind, joint_label,
                                           manual_override, center_lon, center_lat, center_height, degree, business_type_id, model_id,
                                           geometry_signature, socket_signature, detail_status, detail_tileset_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    statement -> bindJointStatement(
                        statement,
                        projectId,
                        node,
                        frontendJointId,
                        jointKind,
                        businessTypeId,
                        modelId,
                        geometrySignature,
                        socketSignature,
                        detailStatus,
                        detailUrl,
                        !jointKind.equals(node.recommendedJointKind())
                    )
                );
            } else {
                boolean socketChanged = !previous.socketSignature().equals(socketSignature);
                if (socketChanged) {
                    markBranchLinesDirty(projectId, previous.branches());
                    markBranchLinesDirty(projectId, node.branches());
                }
                jointDbId = jointDbId(projectId, previous.id());
                jdbcTemplate.update(
                    """
                    UPDATE pipe_joint
                    SET frontend_joint_id = ?, joint_kind = ?, recommended_joint_kind = ?, joint_label = ?, manual_override = ?,
                        center_lon = ?, center_lat = ?, center_height = ?, degree = ?, business_type_id = ?, model_id = ?,
                        geometry_signature = ?, socket_signature = ?, detail_status = ?, detail_tileset_url = ?,
                        updated_at = CURRENT_TIMESTAMP(3)
                    WHERE project_id = ? AND node_key = ?
                    """,
                    frontendJointId,
                    jointKind,
                    node.recommendedJointKind(),
                    jointLabel(jointKind),
                    !jointKind.equals(node.recommendedJointKind()),
                    node.position().lon(),
                    node.position().lat(),
                    node.position().height(),
                    node.degree(),
                    businessTypeId,
                    modelId,
                    geometrySignature,
                    socketSignature,
                    detailStatus,
                    detailUrl,
                    projectId,
                    node.nodeKey()
                );
            }
            jdbcTemplate.update("DELETE FROM pipe_joint_branch WHERE joint_id = ?", jointDbId);
            for (PipeConnectionBranchDto branch : node.branches()) {
                Long lineDbId = nullableLineDbId(projectId, branch.lineId());
                if (lineDbId == null) {
                    continue;
                }
                jdbcTemplate.update(
                    """
                    INSERT INTO pipe_joint_branch(joint_id, line_id, endpoint_role, endpoint_key, direction_x, direction_y, direction_z,
                                                  outer_radius_m, wall_thickness_m, business_type_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    jointDbId,
                    lineDbId,
                    branch.endpointRole(),
                    branch.endpointKey(),
                    branch.direction().x(),
                    branch.direction().y(),
                    branch.direction().z(),
                    branch.outerRadius(),
                    branch.wallThickness(),
                    normalizeBusinessType(branch.businessTypeId())
                );
            }
        }

        for (PipeJointDto previous : previousJoints) {
            if (!nextNodeKeys.contains(previous.nodeKey())) {
                markBranchLinesDirty(projectId, previous.branches());
                jdbcTemplate.update("DELETE FROM pipe_joint WHERE project_id = ? AND node_key = ?", projectId, previous.nodeKey());
            }
        }
    }

    private void markBranchLinesDirty(long projectId, List<PipeConnectionBranchDto> branches) {
        for (PipeConnectionBranchDto branch : branches) {
            jdbcTemplate.update(
                """
                UPDATE pipe_line
                SET detail_status = 'dirty', updated_at = CURRENT_TIMESTAMP(3)
                WHERE project_id = ?
                  AND line_code = ?
                  AND detail_tileset_url IS NOT NULL
                  AND detail_status <> 'generating'
                """,
                projectId,
                branch.lineId()
            );
        }
    }

    private void bindJointStatement(
        PreparedStatement statement,
        long projectId,
        ConnectionNode node,
        String frontendJointId,
        String jointKind,
        String businessTypeId,
        String modelId,
        String geometrySignature,
        String socketSignature,
        String detailStatus,
        String detailUrl,
        boolean manualOverride
    ) throws java.sql.SQLException {
        statement.setLong(1, projectId);
        statement.setString(2, node.nodeKey());
        statement.setString(3, frontendJointId);
        statement.setString(4, jointKind);
        statement.setString(5, node.recommendedJointKind());
        statement.setString(6, jointLabel(jointKind));
        statement.setBoolean(7, manualOverride);
        statement.setDouble(8, node.position().lon());
        statement.setDouble(9, node.position().lat());
        statement.setDouble(10, node.position().height());
        statement.setInt(11, node.degree());
        statement.setString(12, businessTypeId);
        statement.setString(13, modelId);
        statement.setString(14, geometrySignature);
        statement.setString(15, socketSignature);
        statement.setString(16, detailStatus);
        statement.setString(17, detailUrl);
    }

    private ProjectDto loadProject(long projectId) {
        return readService.loadProject(projectId);
    }

    private List<PipeLayerDto> loadLayers(long projectId) {
        return readService.loadLayers(projectId);
    }

    private List<PipeBusinessTypeDto> loadBusinessTypes() {
        return readService.loadBusinessTypes();
    }

    private List<PipeModelOptionDto> loadModelOptions() {
        return readService.loadModelOptions();
    }

    private List<PipePointDto> loadPoints(long projectId) {
        return readService.loadPoints(projectId);
    }

    private List<PipeLineDto> loadLines(long projectId) {
        return readService.loadLines(projectId);
    }

    private List<PipeJointDto> loadJoints(long projectId, List<PipeLineDto> lines) {
        return readService.loadJoints(projectId, lines);
    }

    private long defaultProjectId() {
        return readService.defaultProjectId();
    }

    private long layerDbId(long projectId, String layerCode) {
        return jdbcTemplate.queryForObject(
            "SELECT id FROM pipe_layer WHERE project_id = ? AND layer_code = ?",
            Long.class,
            projectId,
            blankToDefault(layerCode, DEFAULT_LAYER_CODE)
        );
    }

    private long pointDbId(long projectId, String pointCode) {
        Long id = nullablePointDbId(projectId, pointCode);
        if (id == null) {
            throw new IllegalArgumentException("未找到管点 " + pointCode);
        }
        return id;
    }

    private Long nullablePointDbId(long projectId, String pointCode) {
        try {
            return jdbcTemplate.queryForObject(
                "SELECT id FROM pipe_point WHERE project_id = ? AND point_code = ?",
                Long.class,
                projectId,
                pointCode
            );
        } catch (EmptyResultDataAccessException ignored) {
            return null;
        }
    }

    private Long nullableLineDbId(long projectId, String lineCode) {
        try {
            return jdbcTemplate.queryForObject(
                "SELECT id FROM pipe_line WHERE project_id = ? AND line_code = ?",
                Long.class,
                projectId,
                lineCode
            );
        } catch (EmptyResultDataAccessException ignored) {
            return null;
        }
    }

    private long jointDbId(long projectId, String frontendJointId) {
        return jdbcTemplate.queryForObject(
            "SELECT id FROM pipe_joint WHERE project_id = ? AND frontend_joint_id = ?",
            Long.class,
            projectId,
            frontendJointId
        );
    }

    private PipeLineDto findLine(long projectId, String lineCode) {
        return readService.findLine(projectId, lineCode);
    }

    private PipeJointDto findJoint(long projectId, String jointId) {
        return readService.findJoint(projectId, jointId);
    }

    private Long endpointPointDbId(long projectId, PipeEndpointDto endpoint) {
        if (endpoint == null || endpoint.pointId() == null || !"point".equals(endpoint.sourceType())) {
            return null;
        }
        return pointDbId(projectId, endpoint.pointId());
    }

    private boolean endpointReferencesLine(PipeEndpointDto endpoint, String lineCode) {
        return endpoint != null && "line-endpoint".equals(endpoint.sourceType()) && lineCode.equals(endpoint.lineId());
    }

    private String nextCode(long projectId, String tableName, String columnName, String prefix, int width) {
        String sql = "SELECT " + columnName + " FROM " + tableName + " WHERE project_id = ? AND " + columnName + " LIKE ? ORDER BY id DESC LIMIT 1";
        List<String> latest = jdbcTemplate.query(sql, (rs, rowNum) -> rs.getString(1), projectId, prefix + "%");
        int next = 1;
        if (!latest.isEmpty()) {
            String suffix = latest.get(0).replaceFirst("^" + prefix, "");
            try {
                next = Integer.parseInt(suffix) + 1;
            } catch (NumberFormatException ignored) {
                next = latest.size() + 1;
            }
        }
        return prefix + String.format("%0" + width + "d", next);
    }

    private String normalizeBusinessType(String value) {
        return PipelineRules.normalizeBusinessType(value);
    }

    private String normalizeModelForBusiness(String businessTypeId, String modelId, boolean strictExplicit) {
        return PipelineRules.normalizeModelForBusiness(businessTypeId, modelId, strictExplicit);
    }

    private String normalizeJointKind(String jointKind) {
        return PipelineRules.normalizeJointKind(jointKind);
    }

    private List<String> allowedJointKinds(int degree) {
        return PipelineRules.allowedJointKinds(degree);
    }

    private PipeShapeDto normalizeShape(PipeShapeDto shape) {
        PipeShapeDto normalized = shape == null ? PipeShapeDto.circle(0.3, 0.02, 0, 0) : shape;
        double radius = requirePositive(normalized.radius(), "外半径");
        double thickness = requirePositive(normalized.thickness(), "壁厚");
        if (thickness >= radius) {
            throw new IllegalArgumentException("壁厚必须小于外半径");
        }
        return PipeShapeDto.circle(radius, thickness, normalized.flangeLength(), normalized.flangeThickness());
    }

    private void ensureLineBusinessCanChange(PipeLineDto line, List<PipeLineDto> lines, String businessTypeId) {
        Set<String> related = new HashSet<>();
        endpointBusiness(line.start(), lines, line.id()).businessTypeIds().forEach(related::add);
        endpointBusiness(line.end(), lines, line.id()).businessTypeIds().forEach(related::add);
        if (!related.isEmpty() && !(related.size() == 1 && related.contains(businessTypeId))) {
            throw new IllegalArgumentException("该管线连接点已存在其他业务类型，无法切换业务类型");
        }
    }

    private EndpointBusinessResolution endpointBusiness(PipeEndpointDto endpoint, List<PipeLineDto> lines, String ignoreLineId) {
        String endpointKey = resolveEndpointKey(endpoint, lines);
        Set<String> businessTypes = new LinkedHashSet<>();
        for (PipeLineDto line : lines) {
            if (line.id().equals(ignoreLineId)) {
                continue;
            }
            if (resolveEndpointKey(line.start(), lines).equals(endpointKey) || resolveEndpointKey(line.end(), lines).equals(endpointKey)) {
                businessTypes.add(normalizeBusinessType(line.businessTypeId()));
            }
        }
        return new EndpointBusinessResolution(businessTypes);
    }

    private String resolveEndpointKey(PipeEndpointDto endpoint, List<PipeLineDto> lines) {
        return PipelineTopology.resolveEndpointKey(endpoint, lines);
    }

    private String buildConnectionKey(PipeEndpointDto start, PipeEndpointDto end, List<PipeLineDto> lines) {
        return PipelineTopology.buildConnectionKey(start, end, lines);
    }

    private PipeEndpointDto endpointFromPoint(PipePointDto point) {
        return new PipeEndpointDto(
            "point:" + point.id(),
            "point",
            point.id(),
            point.lon(),
            point.lat(),
            point.height(),
            point.id(),
            null,
            null
        );
    }

    private String makeJointId(String nodeId) {
        return PipelineTopology.makeJointId(nodeId);
    }

    private String jointLabel(String jointKind) {
        return PipelineRules.jointLabel(jointKind);
    }

    private String makeJointGeometrySignature(ConnectionNode node, String jointKind, String businessTypeId, String modelId) {
        return PipelineTopology.makeJointGeometrySignature(node, jointKind, businessTypeId, modelId);
    }

    private String makeJointGeometrySignature(PipeJointDto joint, String jointKind, String businessTypeId, String modelId) {
        return PipelineTopology.makeJointGeometrySignature(joint, jointKind, businessTypeId, modelId);
    }

    private String makeJointSocketSignature(ConnectionNode node) {
        return PipelineTopology.makeJointSocketSignature(node);
    }

    private void clearProjectBusinessData(long projectId) {
        jdbcTemplate.update("DELETE FROM pipe_generation_job_item WHERE job_id IN (SELECT id FROM pipe_generation_job WHERE project_id = ?)", projectId);
        jdbcTemplate.update("DELETE FROM pipe_generation_job WHERE project_id = ?", projectId);
        jdbcTemplate.update("DELETE FROM pipe_tile_asset WHERE project_id = ?", projectId);
        jdbcTemplate.update("DELETE FROM pipe_joint WHERE project_id = ?", projectId);
        jdbcTemplate.update("DELETE FROM pipe_line WHERE project_id = ?", projectId);
        jdbcTemplate.update("DELETE FROM pipe_point WHERE project_id = ?", projectId);
    }

    private List<Map<String, String>> readSheet(Sheet sheet) {
        if (sheet == null) {
            return List.of();
        }
        DataFormatter formatter = new DataFormatter(Locale.ROOT);
        Row headerRow = sheet.getRow(0);
        if (headerRow == null) {
            return List.of();
        }
        List<String> headers = new ArrayList<>();
        for (int i = 0; i < headerRow.getLastCellNum(); i += 1) {
            headers.add(normalizeImportHeader(formatter.formatCellValue(headerRow.getCell(i))));
        }
        List<Map<String, String>> rows = new ArrayList<>();
        for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex += 1) {
            Row row = sheet.getRow(rowIndex);
            if (row == null) {
                continue;
            }
            Map<String, String> values = new LinkedHashMap<>();
            boolean hasValue = false;
            for (int col = 0; col < headers.size(); col += 1) {
                String header = headers.get(col);
                if (header.isEmpty()) {
                    continue;
                }
                String value = formatter.formatCellValue(row.getCell(col)).trim();
                if (!value.isEmpty()) {
                    hasValue = true;
                }
                values.put(header, value);
            }
            if (hasValue) {
                rows.add(values);
            }
        }
        return rows;
    }

    private List<Map<String, String>> readCsv(MultipartFile file) throws Exception {
        try (CSVReaderHeaderAware reader = new CSVReaderHeaderAware(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            List<Map<String, String>> rows = new ArrayList<>();
            Map<String, String> row;
            while ((row = reader.readMap()) != null) {
                rows.add(normalizeImportRow(row));
            }
            return rows;
        }
    }

    private Map<String, String> normalizeImportRow(Map<String, String> row) {
        Map<String, String> normalized = new LinkedHashMap<>();
        row.forEach((key, value) -> normalized.put(normalizeImportHeader(key), value));
        return normalized;
    }

    private String normalizeImportHeader(String header) {
        return trim(header).replaceFirst("^\\uFEFF", "");
    }

    private ImportStorage loadImportStorage(long jobId) {
        String json = jdbcTemplate.queryForObject("SELECT preview_json FROM pipe_import_job WHERE id = ?", String.class, jobId);
        try {
            return objectMapper.readValue(json, ImportStorage.class);
        } catch (Exception error) {
            throw new IllegalArgumentException("导入任务预览数据损坏", error);
        }
    }

    private Map<String, String> importAttrs(Map<String, String> row) {
        Map<String, String> attrs = new LinkedHashMap<>(row);
        List.of(
            "point_code", "lon", "lat", "height", "ground_height", "relative_height", "maishen", "business_type",
            "layer_code", "line_code", "start_point_code", "end_point_code", "outer_diameter_mm", "wall_thickness_mm", "model_id"
        ).forEach(attrs::remove);
        return attrs;
    }

    private void validateRequiredNumber(List<ImportErrorDto> errors, String sheet, int rowNumber, Map<String, String> row, String field) {
        try {
            parseNumber(row.get(field), field);
        } catch (Exception error) {
            errors.add(new ImportErrorDto(sheet, rowNumber, field, error.getMessage()));
        }
    }

    private ImportPointHeight resolveImportPointHeight(Map<String, String> row) {
        // Import templates prioritize ground elevation + burial depth, while height remains compatible with old files.
        Double explicitHeight = parseOptionalNumber(row.get("height"), "height");
        Double groundHeight = parseOptionalNumber(row.get("ground_height"), "ground_height");
        Double relativeHeight = parseOptionalNumber(row.get("relative_height"), "relative_height");
        Double maishen = parseOptionalNumber(row.get("maishen"), "maishen");

        Double derivedHeight = null;
        if (groundHeight != null && maishen != null) {
            derivedHeight = groundHeight - maishen;
        } else if (groundHeight != null && relativeHeight != null) {
            derivedHeight = groundHeight + relativeHeight;
        }

        if (derivedHeight == null && explicitHeight == null) {
            throw new IllegalArgumentException("请填写 height，或填写 ground_height + maishen 由系统推导 height");
        }
        if (derivedHeight != null && explicitHeight != null && !nearlyEqual(derivedHeight, explicitHeight)) {
            throw new IllegalArgumentException("height 与 ground_height/maishen 推导值不一致");
        }

        double height = derivedHeight != null ? derivedHeight : explicitHeight.doubleValue();
        if (groundHeight != null && relativeHeight != null && !nearlyEqual(height - groundHeight, relativeHeight)) {
            throw new IllegalArgumentException("relative_height 与 height/ground_height 不一致");
        }
        if (maishen != null && maishen < 0) {
            throw new IllegalArgumentException("maishen 必须为非负数");
        }

        double resolvedRelativeHeight = relativeHeight != null
            ? relativeHeight
            : (groundHeight == null ? 0 : height - groundHeight);
        double resolvedMaishen = maishen != null ? maishen : Math.max(0, -resolvedRelativeHeight);
        return new ImportPointHeight(height, groundHeight, resolvedRelativeHeight, resolvedMaishen);
    }

    private boolean nearlyEqual(double first, double second) {
        return Math.abs(first - second) <= IMPORT_HEIGHT_TOLERANCE_METERS;
    }

    private String requiredText(Map<String, String> row, String field, String sheet, int rowNumber) {
        String value = trim(row.get(field));
        if (value.isEmpty()) {
            throw new IllegalArgumentException(sheet + " 第 " + rowNumber + " 行缺少字段 " + field);
        }
        return value;
    }

    private double parseNumber(String value, String field) {
        String trimmed = trim(value);
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException(field + " 不能为空");
        }
        try {
            double parsed = Double.parseDouble(trimmed);
            if (!Double.isFinite(parsed)) {
                throw new NumberFormatException("not finite");
            }
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(field + " 必须是有效数字");
        }
    }

    private Double parseOptionalNumber(String value) {
        String trimmed = trim(value);
        return trimmed.isEmpty() ? null : parseNumber(trimmed, "可选数字");
    }

    private Double parseOptionalNumber(String value, String field) {
        String trimmed = trim(value);
        return trimmed.isEmpty() ? null : parseNumber(trimmed, field);
    }

    private double parseOptionalNumber(String value, double defaultValue) {
        Double parsed = parseOptionalNumber(value);
        return parsed == null ? defaultValue : parsed;
    }

    private void validateCoordinate(double lon, double lat, double height, String name) {
        if (!Double.isFinite(lon) || lon < -180 || lon > 180) {
            throw new IllegalArgumentException(name + " 经度非法");
        }
        if (!Double.isFinite(lat) || lat < -90 || lat > 90) {
            throw new IllegalArgumentException(name + " 纬度非法");
        }
        if (!Double.isFinite(height)) {
            throw new IllegalArgumentException(name + " 高程非法");
        }
    }

    private double requirePositive(Double value, String name) {
        if (value == null || !Double.isFinite(value) || value <= 0) {
            throw new IllegalArgumentException(name + "必须大于 0");
        }
        return value;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("JSON 序列化失败", error);
        }
    }

    private long insertAndReturnId(String sql, SqlBinder binder) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            binder.bind(statement);
            return statement;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("数据库未返回生成 ID");
        }
        return key.longValue();
    }

    private String blankToDefault(String value, String defaultValue) {
        String trimmed = trim(value);
        return trimmed.isEmpty() ? defaultValue : trimmed;
    }

    private String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private double distanceMeters(PipeEndpointDto start, PipeEndpointDto end) {
        return GeoMath.distanceMeters(start, end);
    }

    private record EndpointBusinessResolution(Set<String> businessTypeIds) {
        boolean mixed() {
            return businessTypeIds.size() > 1;
        }

        String singleBusinessTypeId() {
            return businessTypeIds.size() == 1 ? businessTypeIds.iterator().next() : null;
        }
    }

    private record ImportStorage(List<Map<String, String>> points, List<Map<String, String>> lines) {
    }

    private record ImportPointHeight(double height, Double groundHeight, double relativeHeight, double maishen) {
    }

    @FunctionalInterface
    private interface SqlBinder {
        void bind(PreparedStatement statement) throws java.sql.SQLException;
    }
}
