// src/contentIdentity.js

const axios = require('axios');

const platformFor = downloader => {
    if (['小红书图片下载器', '小红书实况图片下载器', '小红书视频下载器'].includes(downloader)) { return 'xhs'; }
    return downloader === '哔哩哔哩视频下载器' ? 'bilibili' : null;
};

const validateUrl = (raw, platform) => {
    const url = new URL(raw);
    const hosts = platform === 'xhs'
        ? ['xhslink.cn', 'xhslink.com', 'www.xiaohongshu.com', 'xiaohongshu.com']
        : ['b23.tv', 'www.bilibili.com', 'bilibili.com', 'm.bilibili.com'];
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !hosts.includes(url.hostname)) {
        throw new Error('不支持的链接地址');
    }
    return url;
};

const keyFromUrl = (url, platform) => {
    if (platform === 'xhs' && ['www.xiaohongshu.com', 'xiaohongshu.com'].includes(url.hostname)) {
        const match = url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i);
        return match ? `xhs:${match[1].toLowerCase()}` : null;
    }
    if (platform === 'bilibili' && ['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname)) {
        const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
        const page = url.searchParams.get('p') || '1';
        if (match && /^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page))) {
            return `bilibili:${match[1]}:p${Number(page)}`;
        }
    }
    return null;
};

const resolveContentIdentity = async (raw, downloader, get = axios.get) => {
    const platform = platformFor(downloader);
    if (!platform) { return null; }
    let url = validateUrl(raw, platform);
    const deadline = Date.now() + 8000;
    const visited = new Set();
    for (let hop = 0; hop < 5; hop++) {
        const key = keyFromUrl(url, platform);
        if (key) { return key; }
        if (visited.has(url.href) || Date.now() >= deadline) { return null; }
        visited.add(url.href);
        const response = await get(url.href, {
            maxRedirects: 0,
            timeout: Math.max(1, deadline - Date.now()),
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            validateStatus: () => true
        });
        response.data?.destroy?.();
        if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) { return null; }
        url = validateUrl(new URL(response.headers.location, url).href, platform);
    }
    return keyFromUrl(url, platform);
};

module.exports = { resolveContentIdentity };
