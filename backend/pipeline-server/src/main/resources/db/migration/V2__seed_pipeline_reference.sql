INSERT INTO pipeline_project(project_code, name, description, default_project)
VALUES ('default', '默认管网项目', 'Vue Cesium 地下管网默认数据集', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), default_project = VALUES(default_project);

INSERT INTO pipe_business_type(id, name, color, sort_order) VALUES
('water', '给水', '#2f80ed', 1),
('drainage', '排水', '#7b61ff', 2),
('gas', '燃气', '#f2994a', 3)
ON DUPLICATE KEY UPDATE name = VALUES(name), color = VALUES(color), sort_order = VALUES(sort_order);

INSERT INTO pipe_model_style(id, name, description, active) VALUES
('procedural-round', '默认圆管风格', '内部兜底程序化空心圆管，不作为业务正常下拉选项。', 1),
('pipe-pp-pvc', 'PP/PVC 细纹风格', '塑料给排水管常见质感，包含细微轴向纹理。', 1),
('hdpe-black-gas', 'HDPE 黑色燃气管', '黑色聚乙烯燃气管，包含黄色轴向识别条。', 1),
('carbon-steel-new', '工业碳钢无缝管 - 全新', '银灰碳钢管质感，金属度较高。', 1),
('straight-9-metal', '工业碳钢无缝管 - 轻度锈蚀', '灰色金属叠加轻度锈蚀与油污痕迹。', 1),
('carbon-steel-heavy-rust', '工业碳钢无缝管 - 重度锈蚀', '重锈蚀碳钢表面，粗糙度和腐蚀斑点增强。', 1),
('coated-matte', '磨砂涂层风格', '喷涂或防腐涂层管线质感，低反光。', 1),
('ductile-iron-epoxy', '球墨铸铁环氧涂层管', '给水工程常见球墨铸铁管，含环氧涂层和局部磨损。', 1),
('frp-sand-pipe', '玻璃钢夹砂管', '排水和输水场景中的玻璃钢夹砂管质感。', 1),
('galvanized-steel', '镀锌钢管', '镀锌钢管晶粒、纵向接缝和中高金属反光。', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), active = VALUES(active);

INSERT INTO pipe_business_model_style(business_type_id, model_style_id, default_style, sort_order) VALUES
('water', 'ductile-iron-epoxy', 1, 1),
('water', 'pipe-pp-pvc', 0, 2),
('water', 'galvanized-steel', 0, 3),
('water', 'coated-matte', 0, 4),
('drainage', 'frp-sand-pipe', 1, 1),
('drainage', 'pipe-pp-pvc', 0, 2),
('drainage', 'coated-matte', 0, 3),
('gas', 'hdpe-black-gas', 1, 1),
('gas', 'carbon-steel-new', 0, 2),
('gas', 'straight-9-metal', 0, 3),
('gas', 'carbon-steel-heavy-rust', 0, 4)
ON DUPLICATE KEY UPDATE default_style = VALUES(default_style), sort_order = VALUES(sort_order);

INSERT INTO pipe_layer(project_id, layer_code, name, color, visible)
SELECT id, 'default', '默认图层', '#00d4ff', 1
FROM pipeline_project
WHERE project_code = 'default'
ON DUPLICATE KEY UPDATE name = VALUES(name), color = VALUES(color), visible = VALUES(visible);
