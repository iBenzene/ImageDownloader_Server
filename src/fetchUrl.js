// src/fetchUrl.js

const { default: axios } = require('axios');
const { getApp, commonHeaders } = require('../utils/common');
const { URL } = require('url');

/** 发起网络请求, 获取包含目标资源 URL 的 HTML 文本或 JSON 数据 */
const fetchUrl = async (url, downloader, cookie = '') => {
    // 获取请求头和目标地址
    const headers = {
        ...commonHeaders,
        ...(await getHeaders(downloader, cookie)),
    };
    let targetUrl = getTargetUrl(url, downloader);

    // 针对短链, 需要手动解析重定向以保留 Cookie, 因为 Axios 会在跨域重定向时丢失 Cookie
    const isShortLink = (
        (
            (
                downloader === '小红书图片下载器' ||
                downloader === '小红书视频下载器' ||
                downloader === '小红书实况图片下载器'
            ) &&
            targetUrl.includes('xhslink.com')
        ) ||
        (
            downloader === '哔哩哔哩视频下载器' &&
            (targetUrl.includes('b23.tv') || targetUrl.includes('bilibili.com'))
        )
    );
    if ((cookie || headers.Cookie) && isShortLink) {
        targetUrl = await resolveRedirect(targetUrl, headers);
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
        case 'Pixiv 插画下载器':
        case 'Pixiv 动图下载器': {
            // const pixivCookie = cookie || getApp().get('pixivCookie');
            const pixivCookie = getApp().get('pixivCookie');
            if (!pixivCookie) {
                throw new Error('使用 Pixiv 下载器要求正确配置 PIXIV_COOKIE 环境变量');
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
        case 'Twitter (X) 视频下载器':
        case 'Twitter (X) 图片下载器': {
            // const twitterCookie = cookie || getApp().get('twitterCookie');
            const twitterCookie = getApp().get('twitterCookie');
            if (!twitterCookie) {
                throw new Error('使用 Twitter (X) 下载器要求正确配置 TWITTER_COOKIE 环境变量');
            }

            // 提取 ct0 用于 X-CSRF-Token
            const ct0Match = twitterCookie.match(/ct0=([^;]+)/);
            const ct0 = ct0Match ? ct0Match[1] : null;
            if (!ct0) {
                throw new Error('无法从 TWITTER_COOKIE 中提取 ct0 字段, 请确保 Cookie 完整');
            }

            return {
                //（必不可少）标明 Twitter 网页版身份
                'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',

                //（必不可少）X-CSRF-Token
                'X-CSRF-Token': ct0,

                //（必不可少）Cookie
                'Cookie': twitterCookie,
            };
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
            if (!postId) {
                throw new Error('无法从 URL 中提取帖子 ID');
            }
            return `https://bbs-api.miyoushe.com/post/wapi/getPostFull?gids=2&post_id=${postId}&read=1`;
        }
        case '微博图片下载器': {
            const weiboId = url.split('/').pop().split('?')[0];
            if (!weiboId) {
                throw new Error('无法从 URL 中提取微博 ID');
            }
            return `https://weibo.com/ajax/statuses/show?id=${weiboId}&locale=zh-CN`;
        }
        case 'Pixiv 插画下载器': {
            const illustId = url.split('/').pop();
            if (!illustId) {
                throw new Error('无法从 URL 中提取插画 ID');
            }
            return `https://www.pixiv.net/ajax/illust/${illustId}/pages`;
        }
        case 'Pixiv 动图下载器': {
            const illustId = url.split('/').pop();
            if (!illustId) {
                throw new Error('无法从 URL 中提取插画 ID');
            }
            return `https://www.pixiv.net/ajax/illust/${illustId}/ugoira_meta`;
        }
        case 'Twitter (X) 视频下载器':
        case 'Twitter (X) 图片下载器': {
            // 构造 GraphQL 链接
            // https://x.com/master_uwurr/status/...
            // -> https://x.com/i/api/graphql/_8aYOgEDz35BrBcBal1-_w/TweetDetail?variables=...
            const match = url.match(/status\/(\d+)/);
            const tweetId = match ? match[1] : null;
            if (!tweetId) {
                throw new Error('无法从 URL 中提取推文 ID');
            }
            const features = {
                'rweb_video_screen_enabled': false,
                'profile_label_improvements_pcf_label_in_post_enabled': true,
                'rweb_tipjar_consumption_enabled': true,
                'verified_phone_label_enabled': false,
                'creator_subscriptions_tweet_preview_api_enabled': true,
                'responsive_web_graphql_timeline_navigation_enabled': true,
                'responsive_web_graphql_skip_user_profile_image_extensions_enabled': false,
                'premium_content_api_read_enabled': false,
                'communities_web_enable_tweet_community_results_fetch': true,
                'c9s_tweet_anatomy_moderator_badge_enabled': true,
                'responsive_web_grok_analyze_button_fetch_trends_enabled': false,
                'responsive_web_grok_analyze_post_followups_enabled': true,
                'responsive_web_jetfuel_frame': false,
                'responsive_web_grok_share_attachment_enabled': true,
                'articles_preview_enabled': true,
                'responsive_web_edit_tweet_api_enabled': true,
                'graphql_is_translatable_rweb_tweet_is_translatable_enabled': true,
                'view_counts_everywhere_api_enabled': true,
                'longform_notetweets_consumption_enabled': true,
                'responsive_web_twitter_article_tweet_consumption_enabled': true,
                'tweet_awards_web_tipping_enabled': false,
                'responsive_web_grok_show_grok_translated_post': false,
                'responsive_web_grok_analysis_button_from_backend': false,
                'creator_subscriptions_quote_tweet_preview_enabled': false,
                'freedom_of_speech_not_reach_fetch_enabled': true,
                'standardized_nudges_misinfo': true,
                'tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled': true,
                'longform_notetweets_rich_text_read_enabled': true,
                'longform_notetweets_inline_media_enabled': true,
                'responsive_web_grok_image_annotation_enabled': true,
                'responsive_web_enhance_cards_enabled': false
            };
            const fieldToggles = {
                'withArticleRichContentState': true,
                'withArticlePlainText': false,
                'withGrokAnalyze': false,
                'withDisallowedReplyControls': false
            };
            const variables = {
                'focalTweetId': tweetId,
                'cursor': '',
                'referrer': 'tweet',
                'with_rux_injections': false,
                'rankingMode': 'Relevance',
                'includePromotedContent': false,
                'withCommunity': true,
                'withQuickPromoteEligibilityTweetFields': true,
                'withBirdwatchNotes': true,
                'withVoice': true
            };
            return `https://x.com/i/api/graphql/_8aYOgEDz35BrBcBal1-_w/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;
        }
        default: // 小红书图片下载器、小红书视频下载器、哔哩哔哩视频下载器
            return url;
    }
};

/** 生成微博游客 Cookie */
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

/** 手动处理重定向, 避免 Axios 在跨域跳转时丢失 Cookie */
const resolveRedirect = async (url, headers, maxRedirects = 5) => {
    let currentUrl = url;
    try {
        let redirectCount = 0;
        console.debug(`[${new Date().toLocaleString()}] 🔍 开始解析重定向: ${currentUrl}`);

        while (redirectCount < maxRedirects) {
            const response = await axios.get(currentUrl, {
                headers,
                maxRedirects: 0,
                validateStatus: status => status >= 200 && status < 400
            });

            if (response.status >= 300 && response.headers.location) {
                let nextUrl = response.headers.location;
                // 处理相对路径
                if (nextUrl.startsWith('/')) {
                    const u = new URL(currentUrl);
                    nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
                }
                console.debug(`[${new Date().toLocaleString()}] 🔗 解析重定向中: ${currentUrl} -> ${nextUrl}`);
                currentUrl = nextUrl;
                redirectCount++;
            } else {
                break;
            }
        }
        console.debug(`[${new Date().toLocaleString()}] ✅ 解析重定向完成: ${currentUrl}`);
    } catch (error) {
        console.warn(`[${new Date().toLocaleString()}] ⚠️ 解析重定向时出错: ${error.message}`);
    }
    return currentUrl;
};
