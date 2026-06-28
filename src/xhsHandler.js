// src/xhsHandler.js

const { extractJsonFromHtml, shouldUseProxy, ensureHttps } = require('../utils/common');
const { batchCacheResources } = require('./downloadProxy');

const getFirstNote = state => {
    const firstId = state?.note?.firstNoteId;
    if (firstId) {
        return state?.note?.noteDetailMap?.[firstId]?.note;
    }
    return Object.values(state?.note?.noteDetailMap || {})[0]?.note;
};

const getXhsNote = html => {
    if (typeof html !== 'string') {
        console.error(`[${new Date().toLocaleString()}] 响应不是 HTML 文本`);
        return null;
    }

    const state = extractJsonFromHtml(html, 'window.__INITIAL_STATE__');
    return state ? getFirstNote(state) : null;
};

const getXhsImageList = html => {
    const imageList = getXhsNote(html)?.imageList;
    return Array.isArray(imageList) ? imageList : [];
};

/** 提取小红书图片 URL */
const extractXhsImageUrls = html => {
    const urls = [];
    for (const item of getXhsImageList(html)) {
        const imageUrl = getImageUrl(item);
        if (imageUrl) {
            urls.push(imageUrl);
        }
    }
    return [...new Set(urls)];
};

/** 提取小红书视频 URL */
const extractXhsVideoUrls = html => {
    if (typeof html !== 'string') {
        console.error(`[${new Date().toLocaleString()}] 响应不是 HTML 文本`);
        return [];
    }

    const note = getXhsNote(html);
    const urls = [];

    addUrl(urls, getStreamUrl(note?.video?.media?.stream));
    addUrl(urls, getStreamUrl(note?.video?.stream));

    const mediaV2 = parseJson(note?.video?.mediaV2);
    addUrl(urls, getStreamUrl(mediaV2?.stream));
    addUrl(urls, mediaV2?.video?.opaque1?.default_screencast_stream);

    return [...new Set(urls)];
};

/** 提取小红书实况封面和视频的 URL */
const extractXhsLivePhotoUrls = async (response, useProxy) => { // 小红书实况图片下载器
    const html = response.data;

    // 路径: id = note.firstNoteId -> note.noteDetailMap[id].note.imageList
    const imageList = getXhsImageList(html);

    if (imageList.length === 0) { return []; }

    const resultObjects = [];
    try {
        imageList.forEach((item, index) => {
            const imageUrl = getImageUrl(item);
            if (imageUrl) {
                // 检查是否为实况图片
                if (item.livePhoto && item.stream) {
                    // 查找第一个可用的视频编码格式
                    const videoUrl = ensureHttps(getStreamUrl(item.stream));

                    if (videoUrl) {
                        // 实况图片: 同时返回封面和视频
                        resultObjects.push({
                            cover: imageUrl,
                            video: videoUrl,
                        });
                    } else {
                        // 标记为实况图片但没有视频 URL, 当作普通图片处理
                        console.warn(
                            `[${new Date().toLocaleString()}] 实况图片 ${index + 1} 没有可用的视频 URL, 将其当作普通图片处理`
                        );
                        resultObjects.push({
                            cover: imageUrl,
                            video: null,
                        });
                    }
                } else {
                    // 普通图片
                    resultObjects.push({
                        cover: imageUrl,
                        video: null,
                    });
                }
            }
        });
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] 解析 imageList 时出错: ${error}`);
        return [];
    }

    // 如果未开启代理, 直接返回原始对象
    if (!shouldUseProxy(useProxy)) { return resultObjects; }

    // 收集所有需要缓存的 URL
    const allUrls = [];
    for (const item of resultObjects) {
        if (item.cover) { allUrls.push(item.cover); }
        if (item.video) { allUrls.push(item.video); }
    }

    // 批量缓存
    const prefix = 'xhs';
    try {
        const mapping = await batchCacheResources(allUrls, prefix);

        // 替换回对象中
        return resultObjects.map(item => ({
            cover: item.cover ? (mapping.get(item.cover) || item.cover) : null,
            video: item.video ? (mapping.get(item.video) || item.video) : null
        }));
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] 批量缓存小红书实况图片失败: ${error.message}`);
        return resultObjects;
    }
};

/** 从 stream 对象中获取视频 URL */
const getStreamUrl = stream => {
    if (!stream || typeof stream !== 'object') { return null; }

    // 按优先级检查不同的视频编码格式
    const codecPriority = ['av1', 'h266', 'h265', 'h264'];

    for (const codec of codecPriority) {
        if (
            stream[codec] &&
            Array.isArray(stream[codec]) &&
            stream[codec].length > 0
        ) {
            const codecData = stream[codec][0]; // 选择第一个编码选项
            if (codecData.masterUrl || codecData.master_url) {
                return codecData.masterUrl || codecData.master_url;
            }
        }
    }

    // 如果没有找到预期的视频编码格式, 检查其他可能的属性
    console.warn(`[${new Date().toLocaleString()}] 在 stream 对象中未找到预期的视频编码格式, 检查其他可能的属性`);
    for (const key in stream) {
        if (Array.isArray(stream[key]) && stream[key].length > 0) {
            const codecData = stream[key][0];
            if (codecData && (codecData.masterUrl || codecData.master_url)) {
                return codecData.masterUrl || codecData.master_url;
            }
        }
    }

    return null;
};

const addUrl = (urls, url) => {
    const normalizedUrl = ensureHttps((url || '').replace(/\\u002F/g, '/'));
    if (normalizedUrl) {
        urls.push(normalizedUrl);
    }
};

const getImageUrl = item => {
    if (!item || typeof item !== 'object') { return null; }

    const urls = [];
    addUrl(urls, item.urlDefault);
    if (Array.isArray(item.infoList)) {
        for (const info of item.infoList) {
            addUrl(urls, info.url);
        }
    }
    return urls[0] || null;
};

const parseJson = value => {
    if (!value || typeof value !== 'string') { return null; }
    try {
        return JSON.parse(value.replace(/\\u002F/g, '/'));
    } catch {
        return null;
    }
};

module.exports = { extractXhsImageUrls, extractXhsLivePhotoUrls, extractXhsVideoUrls };
