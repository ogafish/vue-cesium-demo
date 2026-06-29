package com.example.pipeline.api;

import com.example.pipeline.api.dto.ApiResponse;
import com.example.pipeline.api.dto.CreateLineRequest;
import com.example.pipeline.api.dto.CreatePointRequest;
import com.example.pipeline.api.dto.GenerateTilesRequest;
import com.example.pipeline.api.dto.GenerateTilesResult;
import com.example.pipeline.api.dto.ImportCommitRequest;
import com.example.pipeline.api.dto.ImportPreviewDto;
import com.example.pipeline.api.dto.JobDto;
import com.example.pipeline.api.dto.PipelineBootstrapDto;
import com.example.pipeline.api.dto.PipelineMutationDto;
import com.example.pipeline.api.dto.UpdateJointKindRequest;
import com.example.pipeline.api.dto.UpdateJointModelRequest;
import com.example.pipeline.api.dto.UpdateLineModelRequest;
import com.example.pipeline.service.PipelineCommandService;
import com.example.pipeline.service.PipelineGenerationJobService;
import com.example.pipeline.service.PipelineImportService;
import com.example.pipeline.service.PipelineQueryService;
import com.example.pipeline.service.PipelineTilesGenerationService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Validated
@RestController
@RequestMapping("/api/pipeline")
public class PipelineController {
    private final PipelineQueryService queryService;
    private final PipelineCommandService commandService;
    private final PipelineImportService importService;
    private final PipelineGenerationJobService jobService;
    private final PipelineTilesGenerationService generationService;

    public PipelineController(
        PipelineQueryService queryService,
        PipelineCommandService commandService,
        PipelineImportService importService,
        PipelineGenerationJobService jobService,
        PipelineTilesGenerationService generationService
    ) {
        this.queryService = queryService;
        this.commandService = commandService;
        this.importService = importService;
        this.jobService = jobService;
        this.generationService = generationService;
    }

    @GetMapping("/projects/default/bootstrap")
    public ApiResponse<PipelineBootstrapDto> bootstrap() {
        return ApiResponse.ok(queryService.bootstrap());
    }

    @PostMapping("/points")
    public ApiResponse<PipelineMutationDto> createPoint(@Valid @RequestBody CreatePointRequest request) {
        return ApiResponse.ok(commandService.createPoint(request));
    }

    @DeleteMapping("/points/{id}")
    public ApiResponse<PipelineMutationDto> deletePoint(@PathVariable String id) {
        return ApiResponse.ok(commandService.deletePoint(id));
    }

    @PostMapping("/lines")
    public ApiResponse<PipelineMutationDto> createLine(@Valid @RequestBody CreateLineRequest request) {
        return ApiResponse.ok(commandService.createLine(request));
    }

    @PatchMapping("/lines/{id}/model")
    public ApiResponse<PipelineMutationDto> updateLineModel(
        @PathVariable String id,
        @Valid @RequestBody UpdateLineModelRequest request
    ) {
        return ApiResponse.ok(commandService.updateLineModel(id, request));
    }

    @DeleteMapping("/lines/{id}")
    public ApiResponse<PipelineMutationDto> deleteLine(@PathVariable String id) {
        return ApiResponse.ok(commandService.deleteLine(id));
    }

    @PatchMapping("/joints/{id}/kind")
    public ApiResponse<PipelineMutationDto> updateJointKind(
        @PathVariable String id,
        @Valid @RequestBody UpdateJointKindRequest request
    ) {
        return ApiResponse.ok(commandService.updateJointKind(id, request));
    }

    @PatchMapping("/joints/{id}/model")
    public ApiResponse<PipelineMutationDto> updateJointModel(
        @PathVariable String id,
        @RequestBody UpdateJointModelRequest request
    ) {
        return ApiResponse.ok(commandService.updateJointModel(id, request));
    }

    @PostMapping("/tiles/generate")
    public ApiResponse<GenerateTilesResult> generateTiles(@Valid @RequestBody GenerateTilesRequest request) {
        return ApiResponse.ok(generationService.generateSingle(request));
    }

    @PostMapping("/tiles/generate-project")
    public ApiResponse<JobDto> generateProject() {
        return ApiResponse.ok(generationService.generateProject());
    }

    @PostMapping(value = "/imports/excel/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportPreviewDto> previewExcel(@RequestParam("file") MultipartFile file) {
        return ApiResponse.ok(importService.previewExcel(file));
    }

    @PostMapping(value = "/imports/csv/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportPreviewDto> previewCsv(
        @RequestParam("points") MultipartFile points,
        @RequestParam("lines") MultipartFile lines
    ) {
        return ApiResponse.ok(importService.previewCsv(points, lines));
    }

    @PostMapping("/imports/{jobId}/commit")
    public ApiResponse<PipelineMutationDto> commitImport(
        @PathVariable long jobId,
        @RequestBody ImportCommitRequest request
    ) {
        return ApiResponse.ok(importService.commitImport(jobId, request));
    }

    @GetMapping("/jobs/{id}")
    public ApiResponse<JobDto> getJob(@PathVariable long id) {
        return ApiResponse.ok(jobService.getJob(id));
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleException(Exception error) {
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return ApiResponse.fail(message);
    }
}
