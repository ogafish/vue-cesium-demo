# Vue Cesium 地下管网三维可视化平台

这是一个基于 Vue 3、Cesium、Spring Boot 和 MySQL 的地下管网三维可视化项目。项目支持管点管线数据管理、Excel/CSV 批量导入、管线精细化模型生成、3D Tiles 加载展示，并提供 Docker Compose 一键部署配置。

## 项目结构

```text
.
|-- vue-cesium-vite/          # 前端项目，Vue 3 + Vite + Cesium
|-- backend/pipeline-server/  # 后端项目，Spring Boot + MySQL
|-- Dockerfile.frontend       # 前端生产镜像构建文件
|-- Dockerfile.backend        # 后端生产镜像构建文件，内置 Node 用于生成 3D Tiles
|-- docker-compose.yml        # 生产部署编排：MySQL + 后端 + 前端 Nginx
|-- nginx.conf                # 前端 Nginx 配置，反代 /api 和 /pipeline-tiles
|-- maven-settings.xml        # Maven 镜像源配置
|-- .env.example              # 部署环境变量示例
`-- DEPLOYMENT.md             # 服务器部署说明
```

## 主要功能

- Cesium 三维地球场景展示
- 地下管点、管线、连接头管理
- 给水、排水、燃气等管线类型展示
- Excel/CSV 批量导入管网数据
- 管线精细化模型生成
- 生成结果以 3D Tiles 形式加载
- Docker Compose 部署，包含容器内 MySQL

## 技术栈

前端：

- Vue 3
- Vite
- TypeScript
- Cesium

后端：

- Java 17
- Spring Boot
- MySQL
- Maven

部署：

- Docker
- Docker Compose
- Nginx
- MySQL 5.7

## 本地开发

### 1. 启动后端

先准备本地 MySQL，并创建项目数据库。后端默认使用 `48090` 端口。

```powershell
cd backend/pipeline-server
$env:PIPELINE_DB_URL="jdbc:mysql://localhost:3306/vue_cesium_pipeline_gis?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false"
$env:PIPELINE_DB_USERNAME="root"
$env:PIPELINE_DB_PASSWORD="你的本地MySQL密码"
$env:PIPELINE_FRONTEND_ROOT="D:\vue-cesium-demo\vue-cesium-vite"
$env:PIPELINE_NODE_COMMAND="node"
mvn spring-boot:run
```

### 2. 启动前端

```powershell
cd vue-cesium-vite
npm install
npm run dev
```

前端开发服务默认通过 Vite 代理访问后端：

```text
/api -> http://localhost:48090
/pipeline-tiles -> http://localhost:48090
```

## Docker 部署

服务器部署推荐直接使用根目录的 Docker Compose 配置。完整流程见：

[DEPLOYMENT.md](./DEPLOYMENT.md)

最小流程如下：

```bash
cp .env.example .env
vim .env
docker compose up -d --build
docker compose ps
```

部署成功后访问：

```text
http://服务器公网IP/
```

## 环境变量

部署时需要在根目录创建 `.env` 文件：

```env
MYSQL_ROOT_PASSWORD=请改成强密码
VITE_TIANDITU_TOKEN=你的天地图Token
VITE_CESIUM_ION_TOKEN=
```

说明：

- `MYSQL_ROOT_PASSWORD` 是容器内 MySQL 的 root 密码。
- `VITE_TIANDITU_TOKEN` 用于加载天地图底图。
- `VITE_CESIUM_ION_TOKEN` 当前可留空，只有使用 Cesium Ion 资源时才需要。

不要把真实 `.env` 提交到 GitHub。

## 数据导入样例

导入样例文件位于：

```text
vue-cesium-vite/docs/import-samples/
```

Excel 导入文件需要包含两个工作表：

- `points`：管点数据
- `lines`：管线数据

字段说明和批量导入说明见：

```text
vue-cesium-vite/docs/真实后端与批量导入说明.md
```

## 常用命令

构建并启动：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看后端日志：

```bash
docker compose logs -f pipeline-backend
```

查看前端日志：

```bash
docker compose logs -f pipeline-frontend
```

停止服务：

```bash
docker compose down
```

停止并删除数据库数据：

```bash
docker compose down -v
```

注意：`down -v` 会删除 MySQL 数据卷，生产环境慎用。

## 端口说明

- `80`：前端 Nginx 对外端口
- `48090`：后端容器内部端口，不直接暴露到公网
- `3306`：MySQL 容器内部端口，不直接暴露到公网

外部浏览器只需要访问 `80` 端口。前端 Nginx 会把 `/api/` 和 `/pipeline-tiles/` 转发到后端容器。

## License

本项目用于地下管网三维可视化实验和部署演示，按项目实际用途自行补充许可证信息。
