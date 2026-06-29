package com.example.pipeline;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@ConfigurationPropertiesScan
@SpringBootApplication
public class PipelineServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(PipelineServerApplication.class, args);
    }
}
