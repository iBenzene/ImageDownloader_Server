// src/parsingResponse.js

const { batchCacheResources } = require('./downloadProxy');
const { getApp, shouldUseProxy, ensureHttps } = require('../utils/common');
const { extractXhsLivePhotoUrls } = require('./xhsHandler');
const { extractBilibiliUrls } = require('./bilibiliHandler');

/** 解析响应的文本, 提取资源的 URL */
const parsingResponse = async (url, response, downloader, useProxy) => {
	if (downloader === '小红书图片下载器' ||
		downloader === '小红书视频下载器' ||
		downloader === '小红书实况图片下载器' ||
		downloader === '哔哩哔哩视频下载器') {
		return await extractUrlsFromHtml(
			url,
			response,
			downloader,
			useProxy
		);
	} else if (downloader === '米游社图片下载器' ||
		downloader === '微博图片下载器' ||
		downloader === 'Pixiv 图片下载器' ||
		downloader === 'Twitter (X) 视频下载器' ||
		downloader === 'Twitter (X) 图片下载器') {
		return await extractUrlsFromJson(
			url,
			response,
			downloader,
			useProxy
		);
	} else {
		return [];
	}
};

module.exports = parsingResponse;

/** 从 HTML 文本中提取资源的 URL */
const extractUrlsFromHtml = async (url, response, downloader, useProxy) => { // 小红书图片下载器、小红书视频下载器、小红书实况图片下载器、哔哩哔哩视频下载器
	const html = response.data;
	if (typeof html !== 'string') {
		console.error(`[${new Date().toLocaleString()}] 响应不是 HTML 文本`);
		return [];
	}

	// 对 HTML 文本进行特殊处理
	switch (downloader) {
		case '小红书实况图片下载器':
			return await extractXhsLivePhotoUrls(response, useProxy);
		case '哔哩哔哩视频下载器': {
			return await extractBilibiliUrls(html, url);
		}
		default:
			break;
	}

	// 使用正则表达式从 HTML 文本中进行匹配
	let regex;
	switch (downloader) {
		case '小红书图片下载器':
			regex = /<meta\s+name="og:image"\s+content="([^"]+)"/g;
			break;
		case '小红书视频下载器':
			regex = /<meta\s+name="og:video"\s+content="([^"]+)"/g;
			break;
		default:
			return [];
	}

	const urls = [];
	let match;
	while ((match = regex.exec(html)) !== null) {
		const u = ensureHttps(match[1].replace(/\\u002F/g, '/'));
		if (u) {
			urls.push(u);
		}
	}

	// 如果未开启代理, 直接返回原始 URLs
	if (!shouldUseProxy(useProxy)) { return urls; }

	// 如果开启了代理, 则将图片缓存到 S3 并返回 S3 URLs
	const prefix = getPrefix(downloader);
	try {
		const mapping = await batchCacheResources(urls, prefix);
		return urls.map(u => mapping.get(u) || u);
	} catch (error) {
		console.error(`[${new Date().toLocaleString()}] 批量缓存${downloader === '小红书图片下载器' ? '小红书图片' : '小红书视频'}失败: ${error.message}`);
		return urls;
	}
};

/** 从 JSON 数据中提取资源的 URL */
const extractUrlsFromJson = async (url, response, downloader, useProxy) => { // 米游社图片下载器、微博图片下载器、Pixiv 图片下载器
	const data = response.data;
	if (!data || typeof data !== 'object') {
		console.error(`[${new Date().toLocaleString()}] 响应不是 JSON 数据`);
		return [];
	}

	const urls = [];
	switch (downloader) {
		case '米游社图片下载器':
			data.data.post.post.images.forEach(image => {
				const url = ensureHttps(image);
				if (url) {
					urls.push(url);
				}
			});

			// 如果开启了代理, 则将图片缓存到 S3 并返回 S3 URLs
			if (shouldUseProxy(useProxy)) {
				try {
					const postId = url.split('/').pop();
					const mapping = await batchCacheResources(urls, 'miyoushe', {}, 5, postId);
					return urls.map(u => mapping.get(u) || u);
				} catch (error) {
					console.error(`[${new Date().toLocaleString()}] 批量缓存米游社图片失败: ${error.message}`);
					return urls;
				}
			}
			return urls;

		case '微博图片下载器':
			data.pic_ids.forEach(picId => {
				const url = ensureHttps(`https://wx1.sinaimg.cn/large/${picId}.jpg`);
				if (url) {
					urls.push(url);
				}
			});

			// 如果开启了代理, 则将图片缓存到 S3 并返回 S3 URLs
			if (shouldUseProxy(useProxy)) {
				try {
					const weiboId = url.split('/').pop().split('?')[0];
					const mapping = await batchCacheResources(urls, 'weibo', {}, 5, weiboId);
					return urls.map(u => mapping.get(u) || u);
				} catch (error) {
					console.error(`[${new Date().toLocaleString()}] 批量缓存微博图片失败: ${error.message}`);
					return urls;
				}
			}
			return urls;
		case 'Pixiv 图片下载器': {
			data.body.forEach(page => {
				if (page.urls && page.urls.original) {
					const url = ensureHttps(page.urls.original);
					if (url) {
						urls.push(url);
					}
				}
			});

			// 如果开启了代理, 则将图片缓存到 S3 并返回 S3 URLs
			if (shouldUseProxy(useProxy)) {
				try {
					const headers = {
						Referer: 'https://www.pixiv.net/',
						Cookie: getApp().get('pixivCookie') || ''
					};
					const illustId = url.split('/').pop();
					const mapping = await batchCacheResources(urls, 'pixiv', headers, 5, illustId);
					return urls.map(u => mapping.get(u) || u);
				} catch (error) {
					console.error(`[${new Date().toLocaleString()}] 批量缓存 Pixiv 图片失败: ${error.message}`);
					return urls;
				}
			}
			return urls;
		}
		case 'Twitter (X) 视频下载器':
		case 'Twitter (X) 图片下载器': {
			try {
				// 尝试查找包含推文内容的时间线入口
				// 通常在 instructions 中, 类型为 TimelineAddEntries
				let instructions = data.data.threaded_conversation_with_injections_v2.instructions;
				let entries = [];
				if (instructions && instructions.length > 0) {
					if (instructions[0].type === 'TimelineAddEntries') {
						entries = instructions[0].entries;
					} else {
						const addEntries = instructions.find(i => i.type === 'TimelineAddEntries');
						entries = addEntries ? addEntries.entries : [];
					}
				}

				// 遍历所有入口, 寻找包含推文内容的条目
				// entryId 通常包含 'tweet-'
				for (const entry of entries) {
					if (entry.entryId.includes('tweet-')) {
						const result = entry.content.itemContent.tweet_results.result;
						// Tweet 对象可能直接在 result 中, 或者在 result.tweet 中 (取决于查询类型)
						const tweet = result.tweet || result;
						const legacy = tweet.legacy;

						if (legacy && legacy.extended_entities && legacy.extended_entities.media) {
							const mediaList = legacy.extended_entities.media;
							// 遍历所有媒体实体 (图片或视频)
							for (const media of mediaList) {
								if (downloader === 'Twitter (X) 视频下载器' && media.type === 'video') {
									if (media.video_info && media.video_info.variants) {
										// 寻找最高码率的视频
										const mp4Variants = media.video_info.variants.filter(v => v.content_type === 'video/mp4');
										if (mp4Variants.length > 0) {
											// 按码率降序排序, 取最大值
											mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
											urls.push(mp4Variants[0].url);
										}
									}
								} else if (downloader === 'Twitter (X) 图片下载器' && media.type === 'photo') {
									// 获取原图
									urls.push(`${media.media_url_https}?name=orig`);
								}
							}
						}
					}
				}

				// 如果开启了代理, 则将图片缓存到 S3 并返回 S3 URLs
				if (shouldUseProxy(useProxy)) {
					try {
						const suffix = url.split('/').pop().split('?')[0];
						const prefix = getPrefix(downloader);
						const mapping = await batchCacheResources(urls, prefix, {}, 5, suffix);
						return urls.map(u => mapping.get(u) || u);
					} catch (error) {
						console.error(`[${new Date().toLocaleString()}] 批量缓存 Twitter 资源失败: ${error.message}`);
						return urls;
					}
				}
			} catch (e) {
				console.error(`[${new Date().toLocaleString()}] 解析 Twitter 响应失败: ${e.message}`);
			}
			return urls;
		}
		default:
			return [];
	}
};

/** 获取下载器的前缀 */
const getPrefix = downloader => {
	if (downloader.includes('小红书')) { return 'xhs'; }
	if (downloader.includes('米游社')) { return 'miyoushe'; }
	if (downloader.includes('微博')) { return 'weibo'; }
	if (downloader.includes('Pixiv')) { return 'pixiv'; }
	if (downloader.includes('Twitter')) { return 'twitter'; }
	return 'other';
};
