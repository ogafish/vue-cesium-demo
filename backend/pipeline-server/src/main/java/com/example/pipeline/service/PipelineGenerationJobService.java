package com.example.pipeline.service;

import com.example.pipeline.api.dto.ImportErrorDto;
import com.example.pipeline.api.dto.JobDto;
import com.example.pipeline.api.dto.JobItemDto;
import com.example.pipeline.domain.PipelineRules;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PipelineGenerationJobService {
    private final JdbcTemplate jdbcTemplate;

    public PipelineGenerationJobService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public JobDto getJob(long id) {
        List<JobItemDto> items = jdbcTemplate.query(
            """
            SELECT target_type, target_id, status, tileset_url, error_message
            FROM pipe_generation_job_item
            WHERE job_id = ?
            ORDER BY id
            """,
            (rs, rowNum) -> new JobItemDto(
                rs.getString("target_type"),
                rs.getString("target_id"),
                rs.getString("status"),
                rs.getString("tileset_url"),
                rs.getString("error_message")
            ),
            id
        );
        try {
            return jdbcTemplate.queryForObject(
                """
                SELECT id, status, total_count, success_count, failed_count, message
                FROM pipe_generation_job
                WHERE id = ?
                """,
                (rs, rowNum) -> new JobDto(
                    rs.getLong("id"),
                    "generation",
                    rs.getString("status"),
                    rs.getInt("total_count"),
                    rs.getInt("success_count"),
                    rs.getInt("failed_count"),
                    rs.getString("message"),
                    items
                ),
                id
            );
        } catch (EmptyResultDataAccessException ignored) {
            return getImportJob(id);
        }
    }

    @Transactional
    public long createGenerationJob(int totalCount) {
        long projectId = defaultProjectId();
        return insertAndReturnId(
            "INSERT INTO pipe_generation_job(project_id, status, total_count, message) VALUES (?, 'running', ?, '正在生成')",
            statement -> {
                statement.setLong(1, projectId);
                statement.setInt(2, totalCount);
            }
        );
    }

    @Transactional
    public void addGenerationJobItem(long jobId, String targetType, String targetId, String status, String url, String error) {
        jdbcTemplate.update(
            """
            INSERT INTO pipe_generation_job_item(job_id, target_type, target_id, status, tileset_url, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            jobId,
            targetType,
            targetId,
            status,
            url,
            error
        );
        Integer success = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM pipe_generation_job_item WHERE job_id = ? AND status = 'success'",
            Integer.class,
            jobId
        );
        Integer failed = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM pipe_generation_job_item WHERE job_id = ? AND status = 'failed'",
            Integer.class,
            jobId
        );
        Integer total = jdbcTemplate.queryForObject(
            "SELECT total_count FROM pipe_generation_job WHERE id = ?",
            Integer.class,
            jobId
        );
        String nextStatus = (success != null && failed != null && total != null && success + failed >= total)
            ? (failed > 0 ? "partial_failed" : "success")
            : "running";
        jdbcTemplate.update(
            """
            UPDATE pipe_generation_job
            SET success_count = ?, failed_count = ?, status = ?, message = ?, updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?
            """,
            success == null ? 0 : success,
            failed == null ? 0 : failed,
            nextStatus,
            "success".equals(nextStatus) ? "生成完成" : ("partial_failed".equals(nextStatus) ? "部分模型生成失败" : "正在生成"),
            jobId
        );
    }

    @Transactional
    public void markLineTileset(String lineCode, String status, String url) {
        long projectId = defaultProjectId();
        jdbcTemplate.update(
            "UPDATE pipe_line SET detail_status = ?, detail_tileset_url = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE project_id = ? AND line_code = ?",
            status,
            url,
            projectId,
            lineCode
        );
    }

    @Transactional
    public void markJointTileset(String jointId, String status, String url) {
        long projectId = defaultProjectId();
        jdbcTemplate.update(
            "UPDATE pipe_joint SET detail_status = ?, detail_tileset_url = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE project_id = ? AND frontend_joint_id = ?",
            status,
            url,
            projectId,
            jointId
        );
    }

    public String signatureHash(String signature) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(signature.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < 8 && i < bytes.length; i += 1) {
                builder.append(String.format("%02x", bytes[i]));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new IllegalStateException("无法计算签名摘要", error);
        }
    }

    private JobDto getImportJob(long id) {
        List<ImportErrorDto> errors = jdbcTemplate.query(
            "SELECT sheet_name, row_number, field_name, message FROM pipe_import_error_row WHERE job_id = ? ORDER BY id",
            (rs, rowNum) -> new ImportErrorDto(
                rs.getString("sheet_name"),
                rs.getInt("row_number"),
                rs.getString("field_name"),
                rs.getString("message")
            ),
            id
        );
        return jdbcTemplate.queryForObject(
            """
            SELECT id, status, total_points, total_lines, error_count, message
            FROM pipe_import_job
            WHERE id = ?
            """,
            (rs, rowNum) -> new JobDto(
                rs.getLong("id"),
                "import",
                rs.getString("status"),
                rs.getInt("total_points") + rs.getInt("total_lines"),
                rs.getInt("total_points") + rs.getInt("total_lines") - rs.getInt("error_count"),
                rs.getInt("error_count"),
                rs.getString("message"),
                errors.stream()
                    .map(error -> new JobItemDto(error.sheetName(), String.valueOf(error.rowNumber()), "failed", null, error.message()))
                    .toList()
            ),
            id
        );
    }

    private long defaultProjectId() {
        return jdbcTemplate.queryForObject(
            "SELECT id FROM pipeline_project WHERE project_code = ?",
            Long.class,
            PipelineRules.DEFAULT_PROJECT_CODE
        );
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

    @FunctionalInterface
    private interface SqlBinder {
        void bind(PreparedStatement statement) throws java.sql.SQLException;
    }
}
