// src/xhsHandler.js

const vm = require('vm');
const { batchCacheResources } = require('./downloadProxy');

/** 提取小红书实况封面和视频的 URL */
const extractXhsLivePhotoUrls = async (response, downloader, useProxy) => { // 小红书实况图片下载器
    const html = response.data;
    if (typeof html !== 'string') {
        console.error(`[${new Date().toLocaleString()}] 响应不是 HTML 文本`);
        return [];
    }
    const state = extractInitialState(html);
    if (!state) { return []; }

    // 路径: id = note.firstNoteId -> note.noteDetailMap[id].note.imageList
    const firstId = state?.note?.firstNoteId;
    const imageList = firstId
        ? state?.note?.noteDetailMap?.[firstId]?.note?.imageList
        : // 兜底: 若没有 firstNoteId 属性, 则尝试拿 noteDetailMap 的第一条
        Object.values(state?.note?.noteDetailMap || {})[0]?.note?.imageList;

    if (!Array.isArray(imageList)) { return []; }

    const resultObjects = [];
    try {
        imageList.forEach((item, index) => {
            if (item.urlDefault) {
                const imageUrl = ensureHttps(item.urlDefault);
                if (!imageUrl) { return; }

                // 检查是否为实况图片
                if (item.livePhoto && item.stream) {
                    // 查找第一个可用的视频编码格式
                    const videoUrl = ensureHttps(getFirstAvailableVideoUrl(item.stream));

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
        console.error(`[${new Date().toLocaleString()}] 批量缓存 ${downloader} 资源失败: ${error.message}`);
        return resultObjects;
    }
};

/** 确保 URL 使用的是 HTTPS 协议, 如果不是 HTTP/HTTPS 则返回 null */
const ensureHttps = url => {
    try {
        const u = new URL(url);
        if (u.protocol === 'http:') { u.protocol = 'https:'; }
        if (u.protocol !== 'https:') { return null; }
        return u.toString();
    } catch {
        return null;
    }
};

/** 判断是否应该使用代理 */
const shouldUseProxy = useProxy => {
    let enabled = false;
    if (useProxy !== undefined) {
        enabled = useProxy === 'true';
    }
    return !!enabled;
};

/** 从 stream 对象中获取第一个可用视频的 URL */
const getFirstAvailableVideoUrl = stream => {
    // 按优先级检查不同的视频编码格式
    const codecPriority = ['av1', 'h266', 'h265', 'h264'];

    for (const codec of codecPriority) {
        if (
            stream[codec] &&
            Array.isArray(stream[codec]) &&
            stream[codec].length > 0
        ) {
            const codecData = stream[codec][0]; // 选择第一个编码选项
            if (codecData.masterUrl) {
                return codecData.masterUrl;
            }
        }
    }

    // 如果没有找到预期的视频编码格式, 检查其他可能的属性
    console.warn(`[${new Date().toLocaleString()}] 在 stream 对象中未找到预期的视频编码格式, 检查其他可能的属性`);
    for (const key in stream) {
        if (Array.isArray(stream[key]) && stream[key].length > 0) {
            const codecData = stream[key][0];
            if (codecData && codecData.masterUrl) {
                return codecData.masterUrl;
            }
        }
    }

    return null;
};

/** 从 HTML 中提取 window.__INITIAL_STATE__ 对象 */
const extractInitialState = html => {
    if (typeof html !== 'string') { throw new Error('html must be a string'); }

    const assignIdx = html.indexOf('window.__INITIAL_STATE__');
    if (assignIdx === -1) { return null; }

    // 找到等号后的第一个 "{"
    const eqIdx = html.indexOf('=', assignIdx);
    if (eqIdx === -1) { return null; }

    let i = eqIdx + 1;

    // 跳过空白
    while (i < html.length && /\s/.test(html[i])) { i++; }
    if (html[i] !== '{') { return null; }

    // 简单大括号配对, 考虑字符串与转义
    let brace = 0, inStr = false, strQuote = '', escape = false;
    const start = i;
    for (; i < html.length; i++) {
        const ch = html[i];

        if (inStr) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === strQuote) {
                inStr = false;
            }
            continue;
        }

        if (ch === '\'' || ch === '"') {
            inStr = true;
            strQuote = ch;
            continue;
        }
        if (ch === '{') { brace++; }
        if (ch === '}') {
            brace--;
            if (brace === 0) {
                // i 指向最后一个 '}'
                break;
            }
        }
    }

    if (brace !== 0) { return null; }

    let objLiteral = html.slice(start, i + 1);

    // 把 \u002F 还原为 /
    objLiteral = objLiteral.replace(/\\u002F/g, '/');

    // JSON/JS 兼容: 把 ": undefined" 替换为 ": null"
    // 只处理键值对语境, 避免误伤字符串
    objLiteral = objLiteral.replace(/:\s*undefined\b/g, ': null');

    // 在 VM 沙箱里只返回这段对象
    const sandbox = {};
    try {
        const script = new vm.Script('(' + objLiteral + ')');
        const context = vm.createContext(sandbox);
        const state = script.runInContext(context, { timeout: 50 });
        return state;
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] 解析 window.__INITIAL_STATE__ 时出错: ${error}`);
        return null;
    }
};

module.exports = { extractXhsLivePhotoUrls };
