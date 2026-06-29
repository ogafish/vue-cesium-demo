package com.example.pipeline.service;

import com.example.pipeline.api.dto.CreateLineRequest;
import com.example.pipeline.api.dto.CreatePointRequest;
import com.example.pipeline.api.dto.PipelineMutationDto;
import com.example.pipeline.api.dto.UpdateJointKindRequest;
import com.example.pipeline.api.dto.UpdateJointModelRequest;
import com.example.pipeline.api.dto.UpdateLineModelRequest;
import org.springframework.stereotype.Service;

@Service
public class PipelineCommandService {
    private final PipelineDataService dataService;

    public PipelineCommandService(PipelineDataService dataService) {
        this.dataService = dataService;
    }

    public PipelineMutationDto createPoint(CreatePointRequest request) {
        return dataService.createPoint(request);
    }

    public PipelineMutationDto deletePoint(String pointCode) {
        return dataService.deletePoint(pointCode);
    }

    public PipelineMutationDto createLine(CreateLineRequest request) {
        return dataService.createLine(request);
    }

    public PipelineMutationDto deleteLine(String lineCode) {
        return dataService.deleteLine(lineCode);
    }

    public PipelineMutationDto updateLineModel(String lineCode, UpdateLineModelRequest request) {
        return dataService.updateLineModel(lineCode, request);
    }

    public PipelineMutationDto updateJointKind(String jointId, UpdateJointKindRequest request) {
        return dataService.updateJointKind(jointId, request);
    }

    public PipelineMutationDto updateJointModel(String jointId, UpdateJointModelRequest request) {
        return dataService.updateJointModel(jointId, request);
    }
}
