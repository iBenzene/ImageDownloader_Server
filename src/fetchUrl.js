// src/fetchUrl.js

const { default: axios } = require('axios');
const { getApp } = require('../utils/common');

const commonHeaders = {
    Accept: '*/*',
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** 发起网络请求, 获取包含目标资源 URL 的 HTML 文本或 JSON 数据 */
const fetchUrl = async (url, downloader, cookie = '') => {
    // 获取请求头和目标地址
    const headers = {
        ...commonHeaders,
        ...(await getHeaders(downloader, cookie)),
    };
    let targetUrl = getTargetUrl(url, downloader);

    // 针对小红书短链 (xhslink.com), 需要手动解析重定向以保留 Cookie, 因为 Axios 会在跨域重定向时丢失 Cookie
    if (
        cookie &&
        (downloader === '小红书图片下载器' ||
            downloader === '小红书视频下载器' ||
            downloader === '小红书实况图片下载器') &&
        targetUrl.includes('xhslink.com')
    ) {
        try {
            const redirectResponse = await axios.get(targetUrl, {
                headers,
                maxRedirects: 0,
                validateStatus: status => status >= 300 && status < 400,
            });
            if (redirectResponse.headers.location) {
                targetUrl = redirectResponse.headers.location;
                console.debug(`[${new Date().toLocaleString()}] 🔗 解析小红书短链跳转: ${targetUrl}`);
            }
        } catch (error) {
            // 如果不是 3xx, 或者发生其他错误, 则忽略, 继续尝试直接请求
            console.warn(`[${new Date().toLocaleString()}] ⚠️ 解析小红书短链失败, 将尝试直接请求: ${error.message}`);
        }
    }

    // 向目标地址发起网络请求
    try {
        console.log(
            `[${new Date().toLocaleString()}] 🔗 向目标地址发起网络请求, headers: ${JSON.stringify(
                headers
            )}, targetUrl: ${targetUrl}`
        );

        return await axios.get(targetUrl, { headers, timeout: 60000 });
    } catch (error) {
        throw new Error(`网络请求失败: ${error.message}`, { cause: error });
    }
};

module.exports = fetchUrl;

/** 获取网络请求的请求头 */
const getHeaders = async (downloader, cookie = '') => {
    switch (downloader) {
        case '米游社图片下载器':
            return {
                //（必不可少）防盗链
                Referer: 'https://www.miyoushe.com/',
            };
        case '微博图片下载器': {
            // 请求生成一个游客 Cookie
            // const weiboCookie = cookie || await generateWeiboCookie();
            const weiboCookie = await generateWeiboCookie();

            let subCookie = '';
            for (const cookieItem of weiboCookie) {
                if (cookieItem.startsWith('SUB=')) {
                    // 只保留 SUB Cookie
                    subCookie = cookieItem;
                    console.log(`[${new Date().toLocaleString()}] 🍪 微博游客 Cookie: ${subCookie}`);
                    break;
                }
            }

            return {
                //（必不可少）Cookie
                Cookie: subCookie,

                //（必不可少）防盗链
                Referer: 'https://weibo.com/',
            };
        }
        case 'Pixiv 图片下载器': {
            // const pixivCookie = cookie || getApp().get('pixivCookie');
            const pixivCookie = getApp().get('pixivCookie');
            if (!pixivCookie) {
                throw new Error('使用 Pixiv 图片下载器要求正确配置 PIXIV_COOKIE 环境变量');
            }
            return {
                //（必不可少）Cookie
                Cookie: pixivCookie,

                //（必不可少）防盗链
                Referer: 'https://www.pixiv.net/',
            };
        }
        case '哔哩哔哩视频下载器': {
            // const bilibiliCookie = cookie || getApp().get('bilibiliCookie');
            const bilibiliCookie = getApp().get('bilibiliCookie');
            if (bilibiliCookie) {
                console.log(`[${new Date().toLocaleString()}] 🍪 哔哩哔哩 Cookie: ${bilibiliCookie}`);
                return {
                    Cookie: bilibiliCookie,
                };
            }
            return {};
        }
        default: // 小红书图片下载器、小红书视频下载器
            if (cookie) {
                if (downloader === '小红书图片下载器' || downloader === '小红书视频下载器' || downloader === '小红书实况图片下载器') {
                    for (const cookieItem of cookie.split(';').map(item => item.trim())) {
                        if (cookieItem.startsWith('web_session')) {
                            console.log(`[${new Date().toLocaleString()}] 🍪 小红书 Cookie: ${cookieItem}`);
                            return {
                                Cookie: cookieItem
                            };
                        }
                    }
                }
                return {
                    Cookie: cookie
                };
            }
            return {};
    }
};

/** 获取网络请求的目标 URL */
const getTargetUrl = (url, downloader) => {
    switch (downloader) {
        case '米游社图片下载器': {
            const postId = url.split('/').pop();
            return `https://bbs-api.miyoushe.com/post/wapi/getPostFull?gids=2&post_id=${postId}&read=1`;
        }
        case '微博图片下载器': {
            const weiboId = url.split('/').pop().split('?')[0];
            return `https://weibo.com/ajax/statuses/show?id=${weiboId}&locale=zh-CN`;
        }
        case 'Pixiv 图片下载器': {
            const illustId = url.split('/').pop();
            return `https://www.pixiv.net/ajax/illust/${illustId}/pages`;
        }
        default: // 小红书图片下载器、小红书视频下载器、哔哩哔哩视频下载器
            return url;
    }
};

const generateWeiboCookie = async () => {
    const headers = {
        ...commonHeaders,

        //（必不可少）内容类型
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    const body = 'cb=visitor_gray_callback&tid=&from=weibo';
    const response = await axios.post(
        'https://passport.weibo.com/visitor/genvisitor2',
        body,
        { headers }
    );

    return response.headers['set-cookie'];
};
