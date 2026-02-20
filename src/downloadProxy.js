// src/downloadProxy.js

const axios = require('axios');
const mime = require('mime-types');
const crypto = require('crypto');
const path = require('path');
const { createS3Client, objectExists, putObject } = require('./s3Client');
const { getApp } = require('../utils/common');

/**
 * 将多个资源批量缓存到 S3, 并返回 S3 URLs
 */
const batchCacheResources = async (urls, prefix, headers = {}, concurrency = 5, sourceId = null) => {
    const results = [];
    // 数组去重
    const queue = Array.from(new Set(urls));
    let idx = 0;

    const worker = async () => {
        while (idx < queue.length) {
            const i = idx++; // 原子操作 (js单线程)
            if (i >= queue.length) { break; }

            const u = queue[i];
            try {
                const s3url = await cacheResourceToS3(u, prefix, headers, sourceId);
                results.push([u, s3url]); // 成功返回映射
            } catch (error) {
                console.error(`[${new Date().toLocaleString()}] 缓存资源失败 (${prefix}): ${u}`, error.message);
                results.push([u, u]); // 失败回退为原 URL
            }
        }
    };

    // 启动 worker
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);

    return new Map(results);
};

/**
 * 将单个资源缓存到 S3, 并返回 S3 URL
 */
const cacheResourceToS3 = async (url, prefix, headers = {}, sourceId = null) => {
    const app = getApp();

    const s3Endpoint = app.get('s3Endpoint');
    const s3Bucket = app.get('s3Bucket');
    const s3AccessKeyId = app.get('s3AccessKeyId');
    const s3SecretAccessKey = app.get('s3SecretAccessKey');
    const s3PublicBase = app.get('s3PublicBase');

    // 如果未配置 S3, 直接返回原 URL
    if (!s3Endpoint || !s3Bucket) {
        return url;
    }

    const s3 = createS3Client({
        endpoint: s3Endpoint,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey
    });

    const key = generateKey(url, prefix, sourceId);
    const enableCacheReuse = app.get('enableCacheReuse');

    try {
        const exists = enableCacheReuse ? await objectExists(s3, s3Bucket, key) : false;
        if (!exists) {
            const { buffer, contentType } = await downloadResource(url, headers);
            console.debug(`[${new Date().toLocaleString()}] 上传资源到 S3: ${key}, size: ${buffer.length}`);
            await putObject(s3, s3Bucket, key, buffer, contentType);
        }
    } catch (error) {
        // 如果出错, 抛出异常让上层捕获
        throw new Error(`S3 操作失败: ${error.message}`, { cause: error });
    }

    return buildPublicUrl({ publicBase: s3PublicBase, endpoint: s3Endpoint, bucket: s3Bucket, key });
};

/**
 * 将单个资源上传到 S3, 并返回 S3 URL
 */
const uploadResourceToS3 = async (url, contentType, prefix, sourceId = null, useOriginalFilename = false) => {
    const fs = require('fs');
    if (!fs.existsSync(url)) {
        throw new Error(`Local file not found: ${url}`);
    }

    const app = getApp();
    const s3Endpoint = app.get('s3Endpoint');
    const s3Bucket = app.get('s3Bucket');
    const s3AccessKeyId = app.get('s3AccessKeyId');
    const s3SecretAccessKey = app.get('s3SecretAccessKey');
    const s3PublicBase = app.get('s3PublicBase');

    if (!s3Endpoint || !s3Bucket) {
        throw new Error('S3 configuration missing');
    }

    const s3 = createS3Client({
        endpoint: s3Endpoint,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey
    });

    // 生成 key
    const key = generateKey(url, prefix, sourceId, useOriginalFilename);
    const enableCacheReuse = app.get('enableCacheReuse');

    try {
        const exists = enableCacheReuse ? await objectExists(s3, s3Bucket, key) : false;
        if (!exists) {
            const buffer = fs.readFileSync(url);
            console.debug(`[${new Date().toLocaleString()}] 上传资源到 S3: ${key}, size: ${buffer.length}`);
            await putObject(s3, s3Bucket, key, buffer, contentType);
        }
    } catch (error) {
        throw new Error(`S3 操作失败: ${error.message}`, { cause: error });
    }

    return buildPublicUrl({ publicBase: s3PublicBase, endpoint: s3Endpoint, bucket: s3Bucket, key });
};

/**
 * 从 S3 获取已存在的单个资源的 URL, 如果不存在则返回 null
 */
const getResourceFromS3 = async (url, prefix, sourceId = null, useOriginalFilename = false) => {
    const app = getApp();

    const s3Endpoint = app.get('s3Endpoint');
    const s3Bucket = app.get('s3Bucket');
    const s3AccessKeyId = app.get('s3AccessKeyId');
    const s3SecretAccessKey = app.get('s3SecretAccessKey');
    const s3PublicBase = app.get('s3PublicBase');

    if (!s3Endpoint || !s3Bucket) {
        return null;
    }

    const s3 = createS3Client({
        endpoint: s3Endpoint,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey
    });

    const key = generateKey(url, prefix, sourceId, useOriginalFilename);
    const enableCacheReuse = app.get('enableCacheReuse');

    try {
        const exists = enableCacheReuse ? await objectExists(s3, s3Bucket, key) : false;
        if (exists) {
            return buildPublicUrl({ publicBase: s3PublicBase, endpoint: s3Endpoint, bucket: s3Bucket, key });
        }
    } catch (error) {
        throw new Error(`S3 操作失败: ${error.message}`, { cause: error });
    }

    return null;
};

/**
 * 下载单个资源
 */
const downloadResource = async (url, headers) => {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers,
        timeout: 30000,
        maxRedirects: 3,
        validateStatus: s => s >= 200 && s < 400
    });

    let contentType = response.headers['content-type'];
    if (!contentType) {
        const guessed = mime.lookup(url);
        if (guessed) { contentType = guessed; }
    }
    return { buffer: Buffer.from(response.data), contentType: contentType || 'application/octet-stream' };
};

module.exports = { batchCacheResources, cacheResourceToS3, uploadResourceToS3, getResourceFromS3 };

/**
 * 根据 URL 生成缓存 Key
 * 格式: cache/<prefix>/[sourceId/]<filename>.<ext>
 */
const generateKey = (url, prefix, sourceId = null, useOriginalFilename = false) => {
    // 去掉 URL 的查询参数
    const cleanUrl = url.split('?')[0];

    // 尝试提取文件后缀 (默认为 jpg)
    let ext = path.extname(cleanUrl).substring(1) || 'jpg';

    // 生成文件名
    let filename;
    if (sourceId || useOriginalFilename) {
        // 如果有 sourceId, 或者显式要求保留原始文件名, 则使用 URL 的最后一部分作为文件名
        const basename = path.basename(cleanUrl);
        filename = basename.includes('.') ? basename.substring(0, basename.lastIndexOf('.')) : basename;
    } else {
        // 如果没有 sourceId 且不保留原始文件名, 则对 URL 进行 MD5 哈希
        filename = crypto.createHash('md5').update(cleanUrl).digest('hex');
    }

    // 拼接最终路径: cache/<prefix>/[sourceId/]<filename>.<ext>
    const finalName = sourceId ? `${sourceId}/${filename}` : filename;
    return `cache/${prefix}/${finalName}.${ext}`;
};

/**
 * 构造公开访问的 URL
 * 优先使用 S3_PUBLIC_BASE, 例如自定义的 CDN 域名, 否则回退为 endpoint + /bucket/key
 */
const buildPublicUrl = ({ publicBase, endpoint, bucket, key }) => {
    if (publicBase) {
        // e.g. https://cdn.example.com/{key}
        return `${publicBase.replace(/\/+$/, '')}/${key}`;
    }
    // path-style: {endpoint}/{bucket}/{key}, e.g. https://<accountid>.r2.cloudflarestorage.com/{bucket}/{key}
    return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
};
