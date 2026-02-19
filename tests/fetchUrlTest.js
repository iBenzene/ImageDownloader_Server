// tests/fetchUrlTest.js
// 示例: node tests/fetchUrlTest.js https://xhslink.com/o/... 小红书图片下载器

const fetchUrl = require('../src/fetchUrl');
const { setApp } = require('../utils/common');
const fs = require('fs');
const path = require('path');

// 加载环境变量
try {
    require('dotenv').config({ path: '.env.local' });
} catch (error) {
    console.warn(`Failed to load .env or .env.local: ${error.message}`);
}

/**
 * Mocking Express App for fetchUrl's dependency on common.getApp()
 */
const mockApp = {
    get: key => {
        switch (key) {
            case 'pixivCookie':
                return process.env.PIXIV_COOKIE || '';
            case 'bilibiliCookie':
                return process.env.BILIBILI_COOKIE || '';
            case 'twitterCookie':
                return process.env.TWITTER_COOKIE || '';
            default:
                return process.env[key] || null;
        }
    }
};

// Initialize app instance for utils/common.js
setApp(mockApp);

/**
 * Test function to fetch URL and save response
 * @param {string} url - The target URL
 * @param {string} downloader - Name of the downloader
 */
async function testFetchUrl(url, downloader) {
    console.log(`\n[Test] Target URL: ${url}`);
    console.log(`[Test] Downloader: ${downloader}`);

    try {
        console.log('[Test] Fetching URL...');
        const response = await fetchUrl(url, downloader);
        const data = response.data;

        // 确定文件扩展名和内容格式
        let ext = '.txt';
        let content = '';

        if (typeof data === 'object') {
            ext = '.json';
            content = JSON.stringify(data, null, 2);
        } else if (typeof data === 'string') {
            // 简单判断是否为 HTML
            if (data.trim().startsWith('<')) {
                ext = '.html';
            }
            content = data;
        } else {
            content = String(data);
        }

        // 生成文件名: tmp/<下载器类型>_<时间戳>.<ext>
        const timestamp = Date.now();

        // 构造文件名
        const safeDownloader = downloader.replace(/\s+/g, '_');
        const filename = `${safeDownloader}_${timestamp}${ext}`;
        const outputDir = path.join(__dirname, '../tmp');
        const outputPath = path.join(outputDir, filename);

        // 确保存储目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, content);
        console.log(`[Test] Response saved to: ${outputPath}`);

    } catch (error) {
        console.error(`[Test] Fetch failed: ${error.message}`);
        if (error.cause) {
            console.error('[Test] Cause:', error.cause.message);
        }
        process.exit(1);
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node tests/fetchUrlTest.js <url> <downloader>');
        console.log('Example: node tests/fetchUrlTest.js "https://example.com" "通用下载器"');
        process.exit(1);
    }

    const [url, downloader] = args;
    testFetchUrl(url, downloader);
}

module.exports = testFetchUrl;
