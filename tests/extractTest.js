// tests/extractTest.js
// 示例: npm test -- "小红书图片下载器" "https://xhslink.com/o/..." true

// 加载环境变量
try {
    require('dotenv').config({ path: '.env.local' });
} catch (error) {
    console.warn(`Failed to load .env or .env.local: ${error.message}`);
}

const parsingResponse = require('../src/parsingResponse');
const fetchUrl = require('../src/fetchUrl');
const { setApp, shouldUseProxy } = require('../utils/common');
const { readExtractCache, writeExtractCache } = require('../src/extractCache');

/**
 * Mocking Express App for parsingResponse's and fetchUrl's dependency on common.getApp()
 * Simply acts as a bridge to process.env
 */
const mockApp = {
    get: key => {
        // 参考 app.js 的逻辑
        switch (key) {
            case 'xhsCookie':
                return process.env.XHS_COOKIE || '';
            case 'bilibiliCookie':
                return process.env.BILIBILI_COOKIE || '';
            case 'pixivCookie':
                return process.env.PIXIV_COOKIE || '';
            case 'twitterCookie':
                return process.env.TWITTER_COOKIE || '';
            case 's3Endpoint':
                return process.env.S3_ENDPOINT || '';
            case 's3Bucket':
                return process.env.S3_BUCKET || '';
            case 's3AccessKeyId':
                return process.env.S3_ACCESS_KEY_ID || '';
            case 's3SecretAccessKey':
                return process.env.S3_SECRET_ACCESS_KEY || '';
            case 's3PublicBase':
                return process.env.S3_PUBLIC_BASE || '';
            case 'enableCacheReuse':
                return process.env.ENABLE_CACHE_REUSE === 'true';
            case 'extractCacheTtl':
                return process.env.EXTRACT_CACHE_TTL_SECONDS || '';
            default:
                return process.env[key] || null;
        }
    }
};

// Initialize app instance for utils/common.js (必需, 否则 parsingResponse/fetchUrl 会报错)
setApp(mockApp);

/**
 * Test function to fetch and extract URLs from a given URL
 * @param {string} url - The target URL
 * @param {string} downloader - Name of the downloader
 * @param {string} useProxy - Whether to use proxy ('true' or 'false')
 */
async function testExtractByUrl(url, downloader, useProxy) {
    console.log(`\n[Test] Testing downloader: ${downloader}`);
    console.log(`[Test] Target URL: ${url}`);
    console.log(`[Test] useProxy: ${useProxy}`);

    try {
        const enableCacheReuse = mockApp.get('enableCacheReuse') && shouldUseProxy(useProxy);

        // 如果开启了缓存, 优先读取 extract 请求缓存, 命中则直接返回 S3 中的数据
        if (enableCacheReuse) {
            const cachedMediaUrls = await readExtractCache(url, downloader);
            if (cachedMediaUrls && cachedMediaUrls.length > 0) {
                console.log(`[Test] [${new Date().toLocaleString()}] extract cache hit: ${downloader}, url: ${url}, return: ${JSON.stringify(cachedMediaUrls, null, 2)}`);
                return cachedMediaUrls;
            }
        }

        // 发起网络请求
        console.log('[Test] Fetching URL...');
        const response = await fetchUrl(url, downloader);

        // 解析网络请求的响应
        console.log('[Test] Parsing response...');
        let mediaUrls = await parsingResponse(url, response, downloader, useProxy);

        // 处理未提取到资源的情况
        if (mediaUrls.length === 0) {
            console.warn(`[Test] 请求 ${url} 的响应: ${JSON.stringify(response.data, null, 2).substring(0, 500)}... (truncated)`);

            const xhsCookie = mockApp.get('xhsCookie');
            if (xhsCookie && (downloader === '小红书图片下载器' || downloader === '小红书实况图片下载器' || downloader === '小红书视频下载器')) {
                console.log('[Test] ⚠️ 未提取到「小红书」资源, 尝试携带 Cookie 重试...');
                try {
                    // 携带 Cookie 再次发起请求
                    const retryResponse = await fetchUrl(url, downloader, xhsCookie);

                    // 解析新的响应
                    const retryMediaUrls = await parsingResponse(url, retryResponse, downloader, useProxy);
                    if (retryMediaUrls.length > 0) {
                        console.log(`[Test] ✅ 携带 Cookie 重试成功, 提取到 ${retryMediaUrls.length} 个资源`);
                        mediaUrls = retryMediaUrls;
                    } else {
                        console.warn('[Test] ❌ 携带 Cookie 重试后仍未提取到资源');
                    }
                } catch (retryError) {
                    console.error(`[Test] ❌ 携带 Cookie 重试请求失败: ${retryError.message}`);
                }
            }
        }

        if (enableCacheReuse && mediaUrls.length > 0) {
            await writeExtractCache(url, downloader, mediaUrls);
        }

        console.log('[Test] Extracted mediaUrls:', JSON.stringify(mediaUrls, null, 2));
        return mediaUrls;
    } catch (error) {
        console.error(`[Test] Extraction failed: ${error.message}`);
        if (error.cause) {
            console.error('[Test] Cause:', error.cause.message);
        }
        throw error;
    }
}

// Support CLI execution: npm test -- "Downloader Name" "https://url.com" "true/false"
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: npm test -- <downloader> <url> [useProxy]');
        console.log('Example: npm test -- "小红书图片下载器" "https://xhslink.com/o/..." true');
        process.exit(1);
    }

    const [downloader, url, useProxyInput] = args;
    const useProxy = useProxyInput || 'false';

    testExtractByUrl(url, downloader, useProxy).catch(error => {
        process.exit(1);
    });
}

module.exports = testExtractByUrl;
