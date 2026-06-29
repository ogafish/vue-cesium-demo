package com.example.pipeline.service;

import com.example.pipeline.api.dto.PipeBusinessTypeDto;
import com.example.pipeline.api.dto.PipeJointDto;
import com.example.pipeline.api.dto.PipeLayerDto;
import com.example.pipeline.api.dto.PipeLineDto;
import com.example.pipeline.api.dto.PipeModelOptionDto;
import com.example.pipeline.api.dto.PipePointDto;
import com.example.pipeline.api.dto.PipelineBootstrapDto;
import com.example.pipeline.domain.PipelineRules;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

@Service
public class PipelineQueryService {
    private final PipelineDataService dataService;
    private final PipelineReadService readService;

    public PipelineQueryService(PipelineDataService dataService, PipelineReadService readService) {
        this.dataService = dataService;
        this.readService = readService;
    }

    public PipelineBootstrapDto bootstrap() {
        long projectId = readService.defaultProjectId();
        dataService.rebuildTopology(projectId);

        List<PipeLayerDto> layers = readService.loadLayers(projectId);
        List<PipeBusinessTypeDto> businessTypes = readService.loadBusinessTypes();
        List<PipeModelOptionDto> modelOptions = readService.loadModelOptions();
        List<PipePointDto> points = readService.loadPoints(projectId);
        List<PipeLineDto> lines = readService.loadLines(projectId);
        List<PipeJointDto> joints = readService.loadJoints(projectId, lines);
        List<String> tilesetUrls = new ArrayList<>();
        lines.stream().map(PipeLineDto::detailTilesetUrl).filter(Objects::nonNull).forEach(tilesetUrls::add);
        joints.stream().map(PipeJointDto::detailTilesetUrl).filter(Objects::nonNull).forEach(tilesetUrls::add);

        return new PipelineBootstrapDto(
            readService.loadProject(projectId),
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

    public PipeLineDto findLine(String lineCode) {
        return readService.findLine(readService.defaultProjectId(), lineCode);
    }

    public PipeJointDto findJoint(String jointId) {
        long projectId = readService.defaultProjectId();
        return readService.findJoint(projectId, jointId);
    }

    public List<PipeLineDto> allLines() {
        return readService.allLines();
    }

    public List<PipeJointDto> allJoints() {
        return readService.allJoints();
    }

    public List<PipeBusinessTypeDto> businessTypes() {
        return readService.businessTypes();
    }
}
