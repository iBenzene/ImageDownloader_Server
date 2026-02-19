// routes/api/extract.js

const express = require('express');
const router = express.Router();

const fetchUrl = require('../../src/fetchUrl');
const parsingResponse = require('../../src/parsingResponse');
const { readExtractCache, writeExtractCache } = require('../../src/extractCache');
const { shouldUseProxy } = require('../../utils/common');

/** 提取出指定 URL 内的图片、实况图片或视频的 URLs */
router.get('/', async (req, res) => {
    const { url, downloader, token, useProxy } = req.query;
    if (token !== req.app.get('token')) {
        console.warn(`[${new Date().toLocaleString()}] 认证失败, token: ${token}`);
        return res.status(401).json({ error: '无法提取资源的 URLs: 认证失败' });
    }
    if (!url || !downloader) {
        return res.status(400).json({ error: '无法提取资源的 URLs: 缺少必要参数' });
    }

    try {
        const proxyEnabled = shouldUseProxy(useProxy);

        // 如果开启了代理, 优先读取 extract 请求缓存, 命中则直接返回 S3 中的数据
        if (proxyEnabled) {
            const cachedMediaUrls = await readExtractCache(url, downloader);
            if (cachedMediaUrls && cachedMediaUrls.length > 0) {
                console.log(`[${new Date().toLocaleString()}] extract cache hit: ${downloader}, url: ${url}`);
                return res.json({ mediaUrls: cachedMediaUrls });
            }
        }

        // 发起网络请求
        const response = await fetchUrl(url, downloader);

        // 解析网络请求的响应
        let mediaUrls = await parsingResponse(url, response, downloader, useProxy);

        // 处理未提取到资源的情况
        if (mediaUrls.length === 0) {
            console.warn(`[${new Date().toLocaleString()}] 请求 ${url} 的响应: ${JSON.stringify(response.data, null, 2)}`);

            // 如果没有提取到资源且是小红书下载器, 尝试使用 Cookie 重试
            const xhsCookie = req.app.get('xhsCookie');
            if (xhsCookie && (downloader === '小红书图片下载器' || downloader === '小红书实况图片下载器' || downloader === '小红书视频下载器')) {
                console.log(`[${new Date().toLocaleString()}] ⚠️ 未提取到「小红书」资源, 尝试携带 Cookie 重试...`);
                try {
                    // 携带 Cookie 再次发起请求
                    const retryResponse = await fetchUrl(url, downloader, xhsCookie);

                    // 解析新的响应
                    const retryMediaUrls = await parsingResponse(url, retryResponse, downloader, useProxy);
                    if (retryMediaUrls.length > 0) {
                        console.log(`[${new Date().toLocaleString()}] ✅ 携带 Cookie 重试成功, 提取到 ${retryMediaUrls.length} 个资源`);
                        mediaUrls = retryMediaUrls;
                    } else {
                        console.warn(`[${new Date().toLocaleString()}] ❌ 携带 Cookie 重试后仍未提取到资源`);
                    }
                } catch (retryError) {
                    console.error(`[${new Date().toLocaleString()}] ❌ 携带 Cookie 重试请求失败: ${retryError.message}`);
                }
            } else {
                throw new Error('响应中不包含任何有效资源的 URL');
            }
        }

        if (proxyEnabled && mediaUrls.length > 0) {
            await writeExtractCache(url, downloader, mediaUrls);
        }

        console.log(`[${new Date().toLocaleString()}] mediaUrls: ${mediaUrls}`);
        res.json({ mediaUrls });
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] 提取资源的 URLs 失败: ${error.message}`);
        try {
            res.status(500).json({ error: `提取资源的 URLs 失败: ${error.message}` });
        } catch (error) {
            console.error(`[${new Date().toLocaleString()}] 响应客户端失败: ${error.message}`);
        }
    }
});

module.exports = router;
