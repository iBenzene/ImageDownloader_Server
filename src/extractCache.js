// src/extractCache.js

const crypto = require('crypto');
const { getApp } = require('../utils/common');
const { createS3Client, getObject, putObject } = require('./s3Client');

const CACHE_PREFIX = 'cache/image-downloader/extract';
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 默认 30 天

/** 读取 extract 请求缓存 */
const readExtractCache = async (url, downloader) => {
    try {
        const config = getS3Config();
        if (!config) { return null; }

        const s3 = createS3Client({
            endpoint: config.endpoint,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        });

        const key = getCacheKey(url, downloader);
        const s3Result = await getObject(s3, config.bucket, key);
        if (!s3Result) { return null; }

        const payload = JSON.parse(s3Result.content);
        if (!Array.isArray(payload.mediaUrls) || payload.mediaUrls.length === 0) {
            return null;
        }

        if (isExpired(payload.expiresAt)) {
            return null;
        }

        return payload.mediaUrls;
    } catch (error) {
        console.warn(`[${new Date().toLocaleString()}] 读取 extract 请求缓存失败: ${error.message}`);
        return null;
    }
};

/** 写入 extract 请求缓存 */
const writeExtractCache = async (url, downloader, mediaUrls) => {
    try {
        if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) { return false; }

        const config = getS3Config();
        if (!config) { return false; }

        // 校验: 所有 URL 必须已转换为 CDN URL, 避免缓存含有未代理原始 URL 的脏数据
        if (config.publicBase) {
            const base = config.publicBase.replace(/\/+$/, '');
            const uncachedUrls = mediaUrls.filter(u => !u.startsWith(base));
            if (uncachedUrls.length > 0) {
                console.warn(`[${new Date().toLocaleString()}] 跳过写入 extract 缓存: ${uncachedUrls.length} 个 URL 未成功转换为 CDN URL`);
                uncachedUrls.forEach(u => console.warn(`  - ${u}`));
                return false;
            }
        }

        const s3 = createS3Client({
            endpoint: config.endpoint,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        });

        const now = Date.now();
        const ttlMs = getTtlMs();
        const payload = {
            url,
            downloader,
            mediaUrls,
            cachedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + ttlMs).toISOString()
        };

        const key = getCacheKey(url, downloader);
        await putObject(
            s3,
            config.bucket,
            key,
            JSON.stringify(payload, null, 2),
            'application/json'
        );
        return true;
    } catch (error) {
        console.warn(`[${new Date().toLocaleString()}] 写入 extract 请求缓存失败: ${error.message}`);
        return false;
    }
};

/** 获取 S3 配置 */
const getS3Config = () => {
    const app = getApp();
    if (!app) { return null; }

    const endpoint = app.get('s3Endpoint');
    const bucket = app.get('s3Bucket');
    const accessKeyId = app.get('s3AccessKeyId');
    const secretAccessKey = app.get('s3SecretAccessKey');
    const publicBase = app.get('s3PublicBase');

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        return null;
    }

    return { endpoint, bucket, accessKeyId, secretAccessKey, publicBase };
};

/** 生成缓存 Key */
const getCacheKey = (url, downloader) => {
    const normalizedUrl = normalizeUrl(url);
    const digest = crypto
        .createHash('md5')
        .update(`${downloader}|${normalizedUrl}`)
        .digest('hex');
    return `${CACHE_PREFIX}/${digest}.json`;
};

/** 规范化 URL */
const normalizeUrl = rawUrl => {
    try {
        const parsed = new URL(rawUrl.trim());
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return String(rawUrl || '').trim();
    }
};

/** 获取缓存的过期时间 (毫秒) */
const getTtlMs = () => {
    const app = getApp();
    const raw = app ? app.get('extractCacheTtl') : null;
    const ttlSeconds = Number(raw);
    const validSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? ttlSeconds
        : DEFAULT_TTL_SECONDS;
    return validSeconds * 1000;
};

/** 检查 extract 请求缓存是否过期 */
const isExpired = expiresAt => {
    if (!expiresAt) { return false; }
    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresAtMs)) { return false; }
    return Date.now() > expiresAtMs;
};

module.exports = { readExtractCache, writeExtractCache, getCacheKey, normalizeUrl };
