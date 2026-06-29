package com.example.pipeline.service;

import com.example.pipeline.api.dto.ImportCommitRequest;
import com.example.pipeline.api.dto.ImportPreviewDto;
import com.example.pipeline.api.dto.PipelineMutationDto;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class PipelineImportService {
    private final PipelineDataService dataService;

    public PipelineImportService(PipelineDataService dataService) {
        this.dataService = dataService;
    }

    public ImportPreviewDto previewExcel(MultipartFile file) {
        return dataService.previewExcel(file);
    }

    public ImportPreviewDto previewCsv(MultipartFile pointsFile, MultipartFile linesFile) {
        return dataService.previewCsv(pointsFile, linesFile);
    }

    public PipelineMutationDto commitImport(long jobId, ImportCommitRequest request) {
        return dataService.commitImport(jobId, request);
    }
}
