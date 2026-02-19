# 苯苯存图（服务端）

将前端中与 UI 无关的代码分离，单独部署，目前只支持通过 Docker 部署。

📝 计划在未来增加无服务器（Serverless）的部署方式，简化流程。

## 🚀 快速开始

### 🐳 Docker 部署

``` bash
sudo docker run -p 3080:3080 -e TOKEN=your_token ghcr.io/ibenzene/image-downloader_server
```
或者

``` yaml
name: image-downloader

services:
  server:
    image: ghcr.io/ibenzene/image-downloader_server
    container_name: image-downloader_server
    ports:
      - 3080:3080
    environment:
      - TZ=Asia/Shanghai
      - TOKEN=your_token
    healthcheck:
      test: 
        - CMD
        - curl
        - -f
        - http://localhost:3080/healthz
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

然后在客户端的「设置」👉「服务端地址」中填入 `http://your_server_ip:3080/api` 或 `https://your_domain/api`，并填入正确的 `TOKEN`。

### ⚙️ 环境变量

| 变量名 | 说明 | 默认值 |
| ------- | ------- | ------- |
| PORT | 监听的端口号 | 3080 |
| TOKEN | 服务端令牌，用于鉴权，需要自己设置 | default_token |
| XHS_COOKIE | 极少数笔记需要 Cookie（含游客 Cookie）才能访问，请自行通过浏览器抓包获取「小红书」Cookie（必须包含 `web_session`） | - |
| BILIBILI_COOKIE | 如需下载大会员专属清晰度的视频，请自行通过浏览器抓包获取哔哩哔哩 Cookie | - |
| PIXIV_COOKIE | 如需使用 Pixiv 图片下载器，请自行通过浏览器抓包获取 Pixiv Cookie | - |
| TWITTER_COOKIE | 如需使用 Twitter (X) 下载器，请自行通过浏览器抓包获取 Twitter (X) Cookie | - |
| S3_ENDPOINT | 符合 S3 规范的对象存储服务器，包括 Amazon S3、Cloudflare R2、MinIO 等，例如 `https://<accountid>.r2.cloudflarestorage.com` | - |
| S3_BUCKET | S3 存储桶的名称 | - |
| S3_ACCESS_KEY_ID | S3 服务的访问凭证 | - |
| S3_SECRET_ACCESS_KEY | S3 服务的访问密钥 | - |
| S3_PUBLIC_BASE | 可选，S3 存储桶的访问路径，允许使用 CDN 或自定义域名，支持 virtual-hosted-style 的访问方式，例如 `https://<accountid>.r2.cloudflarestorage.com/{bucket}` 或 `https://cdn.example.com` | - |

### 🔄 代理下载

目前服务端可代理资源的下载，并缓存到 S3 对象存储服务中，以解决网络不畅、资源失效等问题。

‼️ 如需使用代理下载功能，请配置好 S3 对象存储服务的相关环境变量。其中，「Pixiv 图片下载器」、「哔哩哔哩视频下载器」目前仅支持服务端代理下载。
