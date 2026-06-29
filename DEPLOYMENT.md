# Docker 服务器部署说明

本文档说明如何把本项目部署到云服务器。当前部署方式使用 Docker Compose，一次启动三个容器：

- `pipeline-frontend`：前端 Nginx，暴露服务器 `80` 端口
- `pipeline-backend`：Spring Boot 后端，容器内部端口 `48090`
- `pipeline-mysql`：MySQL 5.7，数据通过 Docker volume 持久化

## 1. 准备服务器

服务器建议使用 Linux，例如 TencentOS、Ubuntu、Debian、CentOS。需要提前安装：

- Git
- Docker
- Docker Compose 插件

检查命令：

```bash
git --version
docker --version
docker compose version
```

如果服务器防火墙或腾讯云安全组未开放 HTTP，需要放行：

```text
TCP 80
```

如后续配置 HTTPS，再放行：

```text
TCP 443
```

## 2. 选择部署目录

推荐把项目放在 `/opt` 下，目录清晰，后续维护方便：

```bash
sudo mkdir -p /opt/apps
sudo chown -R $USER:$USER /opt/apps
cd /opt/apps
```

如果你已经有自己的应用目录，也可以放到类似：

```text
/opt/apps/vue-cesium-demo
/srv/apps/vue-cesium-demo
/data/apps/vue-cesium-demo
```

不要随手散放在 `/root`、`/home` 多个目录里，否则后续更新和排查会很乱。

## 3. 克隆项目

```bash
cd /opt/apps
git clone https://github.com/ogafish/vue-cesium-demo.git
cd vue-cesium-demo
```

如果仓库地址不同，把上面的 URL 换成你的实际 GitHub 仓库地址。

## 4. 创建生产环境变量

根目录已有 `.env.example`，复制一份为 `.env`：

```bash
cp .env.example .env
vim .env
```

示例：

```env
MYSQL_ROOT_PASSWORD=请改成你的强密码
VITE_TIANDITU_TOKEN=你的天地图Token
VITE_CESIUM_ION_TOKEN=
```

说明：

- `MYSQL_ROOT_PASSWORD` 是容器内 MySQL 的 root 密码，必须改成强密码。
- `VITE_TIANDITU_TOKEN` 是天地图 token，前端构建时会写入生产包。
- `VITE_CESIUM_ION_TOKEN` 当前项目可以留空，除非你启用了 Cesium Ion 资源。

不要提交真实 `.env` 到 GitHub。

## 5. 构建并启动容器

在项目根目录执行：

```bash
docker compose up -d --build
```

首次构建会下载 Node、Maven、JDK、Nginx、MySQL 镜像，并安装前后端依赖，耗时较长是正常的。

国内服务器如果下载依赖很慢，建议配置 Docker 镜像源，或在服务器网络较好的时间段重新构建。

## 6. 查看运行状态

```bash
docker compose ps
```

正常情况下应看到类似状态：

```text
pipeline-frontend   Up   0.0.0.0:80->80/tcp
pipeline-backend    Up
pipeline-mysql      Up (healthy)
```

后端没有对宿主机暴露端口是正常的。浏览器请求会先进入前端 Nginx，再由 Nginx 在 Docker 网络中转发到后端。

## 7. 查看日志

查看全部日志：

```bash
docker compose logs -f
```

只看后端：

```bash
docker compose logs -f pipeline-backend
```

只看前端：

```bash
docker compose logs -f pipeline-frontend
```

只看 MySQL：

```bash
docker compose logs -f mysql
```

## 8. 访问系统

浏览器打开：

```text
http://服务器公网IP/
```

如果绑定了域名：

```text
http://你的域名/
```

## 9. 验证后端接口

可以从服务器本机执行：

```bash
curl http://127.0.0.1/api/pipeline/projects/default/bootstrap
```

如果返回 JSON，说明前端 Nginx 到后端的反向代理正常。

也可以直接在容器网络里验证后端：

```bash
docker compose exec pipeline-backend wget -qO- http://127.0.0.1:48090/api/pipeline/projects/default/bootstrap
```

## 10. 查看数据库内容

进入 MySQL 容器：

```bash
docker compose exec mysql mysql -uroot -p
```

输入 `.env` 里的 `MYSQL_ROOT_PASSWORD`。

进入数据库：

```sql
USE vue_cesium_pipeline_gis;
SHOW TABLES;
SELECT * FROM pipeline_project;
SELECT * FROM pipeline_point LIMIT 10;
SELECT * FROM pipeline_line LIMIT 10;
```

退出：

```sql
exit;
```

## 11. 更新部署

本地修改代码并 push 到 GitHub 后，服务器进入项目目录：

```bash
cd /opt/apps/vue-cesium-demo
git pull
docker compose up -d --build
```

如果只是改了 `.env` 中的 token 或密码，也建议重新构建前端：

```bash
docker compose up -d --build pipeline-frontend
```

如果改了后端代码：

```bash
docker compose up -d --build pipeline-backend
```

## 12. 停止和删除

停止容器，但保留数据库数据：

```bash
docker compose down
```

重新启动：

```bash
docker compose up -d
```

停止并删除数据库数据卷：

```bash
docker compose down -v
```

注意：`down -v` 会删除 `mysql-data` 和生成模型数据卷，生产环境慎用。

## 13. 数据和模型持久化

当前 `docker-compose.yml` 使用两个 volume：

```yaml
volumes:
  mysql-data:
  pipeline-tiles-generated:
```

含义：

- `mysql-data`：保存 MySQL 数据库内容。
- `pipeline-tiles-generated`：保存后端生成的 3D Tiles 模型文件。

因此正常更新镜像、重启容器不会丢失数据库和已生成模型。

## 14. 常见问题

### 14.1 访问不了页面

检查容器状态：

```bash
docker compose ps
```

检查服务器安全组和防火墙是否放行 `80` 端口。

### 14.2 后端容器一直 Restarting

查看后端日志：

```bash
docker compose logs --tail=200 pipeline-backend
```

重点检查：

- MySQL 是否 healthy
- `.env` 中 `MYSQL_ROOT_PASSWORD` 是否正确
- 后端是否能连接 `mysql:3306`
- 3D Tiles 生成脚本依赖是否完整

### 14.3 前端能打开，但接口 404

检查 `nginx.conf` 中是否包含：

```nginx
location /api/ {
    proxy_pass http://pipeline-backend:48090;
}

location /pipeline-tiles/ {
    proxy_pass http://pipeline-backend:48090;
}
```

修改后重新构建前端镜像：

```bash
docker compose up -d --build pipeline-frontend
```

### 14.4 生成模型后浏览器 404

生成模型文件需要后端和前端共享 `pipeline-tiles-generated` volume。确认 `docker-compose.yml` 中后端包含：

```yaml
volumes:
  - pipeline-tiles-generated:/app/frontend/public/pipeline-tiles/generated
```

如果这个 volume 被删除，历史生成模型也会消失，需要重新生成。

### 14.5 Cross-Origin-Opener-Policy 警告

如果使用 `http://服务器IP` 访问，浏览器可能提示 COOP/COEP header 在非可信源下被忽略。这通常不影响项目基本使用。

正式环境建议配置域名和 HTTPS。

### 14.6 重新构建很慢

首次构建需要下载 npm、Maven 和 Docker 镜像依赖，半小时以上也可能发生。可以：

- 给 Docker 配置国内镜像源。
- 保留 Docker build cache，不要频繁执行系统清理。
- 只重建改动过的服务，例如 `pipeline-frontend` 或 `pipeline-backend`。

## 15. GitHub 提交建议

提交部署相关文件时建议只提交这些文件：

```bash
git add README.md DEPLOYMENT.md .env.example .dockerignore docker-compose.yml Dockerfile.backend Dockerfile.frontend nginx.conf maven-settings.xml
git commit -m "docs: add docker deployment guide"
git push
```

不要提交：

```text
.env
vue-cesium-vite/.env
node_modules/
target/
dist/
backup/
*.7z
```
