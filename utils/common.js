// utils/common.js
const vm = require('vm');

// 注册 App 示例, 方便在其他模块中获取
let appInstance = null;

const setApp = app => {
    appInstance = app;
};

const getApp = () => {
    return appInstance;
};

/** 通用请求头 */
const commonHeaders = {
    Accept: '*/*',
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** 判断是否应该使用代理 */
const shouldUseProxy = useProxy => {
    let enabled = false;
    if (useProxy !== undefined) {
        enabled = useProxy === 'true';
    }
    return !!enabled;
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

/**
 * 从 HTML 中提取指定变量的 JS 对象
 * @param {string} html HTML 内容
 * @param {string} variableName 变量名, 如 'window.__INITIAL_STATE__'
 * @returns {Object|null} 解析后的对象
 */
const extractJsonFromHtml = (html, variableName) => {
    if (typeof html !== 'string' || !variableName) { return null; }

    const startIndex = html.indexOf(variableName);
    if (startIndex === -1) { return null; }

    // 寻找第一个 '{' 或 '[' (以支持数组)
    // 兼容 B 站 (variableName 后可能有其他字符) 和 小红书 (variableName = {...})
    let i = startIndex + variableName.length;
    while (i < html.length && html[i] !== '{' && html[i] !== '[') {
        i++;
    }

    if (i >= html.length) { return null; }

    const startChar = html[i];
    const endChar = startChar === '{' ? '}' : ']';

    // 简单配对, 考虑字符串与转义
    let brace = 0, inStr = false, strQuote = '', escape = false;
    const start = i;

    // 从 i 开始遍历
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

        if (ch === startChar) { brace++; }
        if (ch === endChar) {
            brace--;
            if (brace === 0) {
                break;
            }
        }
    }

    if (brace !== 0) { return null; }

    let objLiteral = html.slice(start, i + 1);

    // 把 \u002F 还原为 /
    objLiteral = objLiteral.replace(/\\u002F/g, '/');

    // JSON/JS 兼容: 把 ": undefined" 替换为 ": null"
    objLiteral = objLiteral.replace(/:\s*undefined\b/g, ': null');

    const sandbox = {};
    try {
        // (obj) 避免对象字面量被解析为块
        const script = new vm.Script('result = (' + objLiteral + ')');
        const context = vm.createContext(sandbox);
        script.runInContext(context, { timeout: 50 });
        return sandbox.result;
    } catch (error) {
        return null; // Silent fail or log if needed, but keeping it simple for common util
    }
};

module.exports = { setApp, getApp, commonHeaders, shouldUseProxy, ensureHttps, extractJsonFromHtml };
