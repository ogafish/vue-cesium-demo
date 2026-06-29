CREATE TABLE IF NOT EXISTS pipeline_project (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  default_project TINYINT(1) NOT NULL DEFAULT 0,
  bbox_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_layer (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  layer_code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  color VARCHAR(16) NOT NULL,
  visible TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_pipe_layer_project_code (project_id, layer_code),
  CONSTRAINT fk_pipe_layer_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_business_type (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  color VARCHAR(16) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_model_style (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_business_model_style (
  business_type_id VARCHAR(32) NOT NULL,
  model_style_id VARCHAR(64) NOT NULL,
  default_style TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (business_type_id, model_style_id),
  CONSTRAINT fk_pbms_business FOREIGN KEY (business_type_id) REFERENCES pipe_business_type(id),
  CONSTRAINT fk_pbms_model FOREIGN KEY (model_style_id) REFERENCES pipe_model_style(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_point (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  point_code VARCHAR(64) NOT NULL,
  lon DOUBLE NOT NULL,
  lat DOUBLE NOT NULL,
  height DOUBLE NOT NULL,
  ground_height DOUBLE NULL,
  relative_height DOUBLE NOT NULL DEFAULT 0,
  maishen DOUBLE NOT NULL DEFAULT 0,
  layer_id BIGINT NOT NULL,
  business_type_id VARCHAR(32) NOT NULL,
  geom POINT NOT NULL,
  attrs_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_pipe_point_project_code (project_id, point_code),
  SPATIAL INDEX idx_pipe_point_geom (geom),
  CONSTRAINT fk_pipe_point_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipe_point_layer FOREIGN KEY (layer_id) REFERENCES pipe_layer(id),
  CONSTRAINT fk_pipe_point_business FOREIGN KEY (business_type_id) REFERENCES pipe_business_type(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_line (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  line_code VARCHAR(64) NOT NULL,
  start_point_id BIGINT NULL,
  end_point_id BIGINT NULL,
  start_endpoint_json JSON NOT NULL,
  end_endpoint_json JSON NOT NULL,
  start_lon DOUBLE NOT NULL,
  start_lat DOUBLE NOT NULL,
  start_height DOUBLE NOT NULL,
  end_lon DOUBLE NOT NULL,
  end_lat DOUBLE NOT NULL,
  end_height DOUBLE NOT NULL,
  layer_id BIGINT NOT NULL,
  business_type_id VARCHAR(32) NOT NULL,
  model_id VARCHAR(64) NOT NULL,
  shape_type VARCHAR(32) NOT NULL DEFAULT 'circle',
  outer_radius_m DOUBLE NOT NULL,
  wall_thickness_m DOUBLE NOT NULL,
  flange_length_m DOUBLE NOT NULL DEFAULT 0,
  flange_thickness_m DOUBLE NOT NULL DEFAULT 0,
  length_m DOUBLE NOT NULL,
  connection_key VARCHAR(255) NOT NULL,
  detail_status VARCHAR(32) NOT NULL DEFAULT 'none',
  detail_tileset_url VARCHAR(512) NULL,
  attrs_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_pipe_line_project_code (project_id, line_code),
  UNIQUE KEY uk_pipe_line_project_connection (project_id, connection_key),
  KEY idx_pipe_line_project_business (project_id, business_type_id),
  CONSTRAINT fk_pipe_line_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipe_line_start_point FOREIGN KEY (start_point_id) REFERENCES pipe_point(id) ON DELETE SET NULL,
  CONSTRAINT fk_pipe_line_end_point FOREIGN KEY (end_point_id) REFERENCES pipe_point(id) ON DELETE SET NULL,
  CONSTRAINT fk_pipe_line_layer FOREIGN KEY (layer_id) REFERENCES pipe_layer(id),
  CONSTRAINT fk_pipe_line_business FOREIGN KEY (business_type_id) REFERENCES pipe_business_type(id),
  CONSTRAINT fk_pipe_line_model FOREIGN KEY (model_id) REFERENCES pipe_model_style(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_joint (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  node_key VARCHAR(255) NOT NULL,
  frontend_joint_id VARCHAR(255) NOT NULL,
  joint_kind VARCHAR(32) NOT NULL,
  recommended_joint_kind VARCHAR(32) NOT NULL,
  joint_label VARCHAR(64) NOT NULL,
  manual_override TINYINT(1) NOT NULL DEFAULT 0,
  center_lon DOUBLE NOT NULL,
  center_lat DOUBLE NOT NULL,
  center_height DOUBLE NOT NULL,
  degree INT NOT NULL,
  business_type_id VARCHAR(32) NOT NULL,
  model_id VARCHAR(64) NOT NULL,
  geometry_signature VARCHAR(1024) NOT NULL,
  socket_signature VARCHAR(1024) NOT NULL,
  detail_status VARCHAR(32) NOT NULL DEFAULT 'none',
  detail_tileset_url VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_pipe_joint_project_node (project_id, node_key),
  CONSTRAINT fk_pipe_joint_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipe_joint_business FOREIGN KEY (business_type_id) REFERENCES pipe_business_type(id),
  CONSTRAINT fk_pipe_joint_model FOREIGN KEY (model_id) REFERENCES pipe_model_style(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_joint_branch (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  joint_id BIGINT NOT NULL,
  line_id BIGINT NOT NULL,
  endpoint_role VARCHAR(16) NOT NULL,
  endpoint_key VARCHAR(255) NOT NULL,
  direction_x DOUBLE NOT NULL,
  direction_y DOUBLE NOT NULL,
  direction_z DOUBLE NOT NULL,
  outer_radius_m DOUBLE NOT NULL,
  wall_thickness_m DOUBLE NOT NULL,
  business_type_id VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pipe_joint_branch_joint FOREIGN KEY (joint_id) REFERENCES pipe_joint(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipe_joint_branch_line FOREIGN KEY (line_id) REFERENCES pipe_line(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipe_joint_branch_business FOREIGN KEY (business_type_id) REFERENCES pipe_business_type(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_tile_asset (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(255) NOT NULL,
  output_subdir VARCHAR(255) NOT NULL,
  tileset_url VARCHAR(512) NULL,
  signature_hash VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  error_message TEXT NULL,
  generated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_pipe_tile_asset_target (project_id, target_type, target_id),
  CONSTRAINT fk_pipe_tile_asset_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_import_job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  file_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  mode VARCHAR(32) NOT NULL DEFAULT 'append',
  auto_generate TINYINT(1) NOT NULL DEFAULT 0,
  mapping_json JSON NULL,
  preview_json JSON NULL,
  message TEXT NULL,
  total_points INT NOT NULL DEFAULT 0,
  total_lines INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pipe_import_job_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_import_error_row (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_id BIGINT NOT NULL,
  sheet_name VARCHAR(64) NOT NULL,
  row_number INT NOT NULL,
  field_name VARCHAR(64) NULL,
  raw_json JSON NULL,
  message TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pipe_import_error_job FOREIGN KEY (job_id) REFERENCES pipe_import_job(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_generation_job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  total_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pipe_generation_job_project FOREIGN KEY (project_id) REFERENCES pipeline_project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipe_generation_job_item (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_id BIGINT NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  tileset_url VARCHAR(512) NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pipe_generation_item_job FOREIGN KEY (job_id) REFERENCES pipe_generation_job(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
