// src/bilibiliHandler.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const { uploadResourceToS3, getResourceFromS3 } = require('./downloadProxy');
const { extractJsonFromHtml, downloadStream } = require('../utils/common');

// 配置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * 提取 bilibili 视频和音频 URL, 合并并上传到 S3
 */
const extractBilibiliUrls = async (html, url) => {
    let tempDir = null;
    try {
        // 提取 playinfo
        const playinfo = extractJsonFromHtml(html, 'window.__playinfo__');
        if (!playinfo) {
            console.error(`[${new Date().toLocaleString()}] 未找到 bilibili playinfo`);
            return [];
        }

        // 选择最佳流
        const { videoUrl, audioUrl, videoQualityId, audioQualityId } = getBestStreams(playinfo);
        if (!videoUrl || !audioUrl) {
            console.error(`[${new Date().toLocaleString()}] 未能提取到有效的视频或音频流`);
            return [];
        }

        // 生成唯一文件名
        let filename;
        const initialState = extractJsonFromHtml(html, 'window.__INITIAL_STATE__');
        if (initialState && initialState.bvid) {
            filename = initialState.bvid;
            console.debug(`[${new Date().toLocaleString()}] 使用 window.__INITIAL_STATE__.bvid 作为文件名: ${filename}`);
        } else {
            // 尝试从 URL 中提取 ID
            filename = extractBvIdFromUrl(url);
            if (filename) {
                console.debug(`[${new Date().toLocaleString()}] 使用 URL 中的 ID 作为文件名: ${filename}`);
            } else {
                // 如果都失败了, 使用去除所有查询参数后的 URL 哈希值作为文件名
                const cleanUrl = url.split('?')[0];
                filename = crypto.createHash('md5').update(cleanUrl).digest('hex');
                console.debug(`[${new Date().toLocaleString()}] 使用 URL 哈希值作为文件名: ${filename}`);
            }
        }

        // 加上质量标识
        if (videoQualityId) {
            filename += `_${videoQualityId}`;
        }
        if (audioQualityId) {
            filename += `_${audioQualityId}`;
        }

        // 优先检查 S3 是否已有合成后的视频, 命中则直接返回
        const cachedS3Url = await getResourceFromS3(`${filename}.mp4`, 'bilibili', null, true);
        if (cachedS3Url) {
            console.debug(`[${new Date().toLocaleString()}] bilibili 视频命中 S3 缓存: ${cachedS3Url}`);
            return [cachedS3Url];
        }

        // 创建临时目录
        const baseDir = path.join(__dirname, '../tmp');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        tempDir = path.join(baseDir, `bilibili_${filename}_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const videoPath = path.join(tempDir, `video.m4s`); // B站通常是 m4s
        const audioPath = path.join(tempDir, `audio.m4s`);
        const outputPath = path.join(tempDir, `${filename}.mp4`);

        // 下载流
        console.debug(`[${new Date().toLocaleString()}] 开始下载 bilibili 视频流...`);
        const headers = {
            'Referer': 'https://www.bilibili.com/'
        };
        await Promise.all([
            downloadStream(videoUrl, videoPath, headers),
            downloadStream(audioUrl, audioPath, headers)
        ]);

        // 合并音视频
        console.log(`[${new Date().toLocaleString()}] 开始合成 bilibili 视频...`);
        await mergeStreams(videoPath, audioPath, outputPath);

        // 上传到 S3
        console.debug(`[${new Date().toLocaleString()}] 开始上传 bilibili 视频到 S3...`);
        const s3Url = await uploadResourceToS3(outputPath, 'video/mp4', 'bilibili', null, true);

        // 清理临时文件
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;

        console.debug(`[${new Date().toLocaleString()}] bilibili 视频处理完成: ${s3Url}`);
        return [s3Url];

    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] bilibili 视频处理失败: ${error.message}`);
        return [];
    } finally {
        // 检查临时文件是否清理干净
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) {
                console.error(`[${new Date().toLocaleString()}] 清理临时文件失败: ${e.message}`);
            }
        }
    }
};

/**
 * 从 URL 中提取 BV 号
 */
const extractBvIdFromUrl = url => {
    if (!url) return null;
    try {
        // 移除查询参数
        const cleanUrl = url.split('?')[0];
        // 匹配 BV 号
        const match = cleanUrl.match(/(BV[0-9a-zA-Z]{10})/);
        return match ? match[1] : null;
    } catch (e) {
        console.error('提取 BV 号失败', e);
        return null;
    }
};

/**
 * 获取质量最高的视频和音频流
 */
const getBestStreams = playinfo => {
    const dash = playinfo.data?.dash;
    if (!dash) { return { videoUrl: null, audioUrl: null, videoQualityId: null, audioQualityId: null }; }

    // 视频: 找 ID 最大的, 代表清晰度最高
    let videoUrl = null;
    let videoQualityId = null;

    if (dash.video && dash.video.length > 0) {
        // 按 ID 降序排序
        dash.video.sort((a, b) => b.id - a.id);
        const bestVideo = dash.video[0];
        videoUrl = bestVideo.baseUrl;
        videoQualityId = bestVideo.id;
        console.debug(`[${new Date().toLocaleString()}] 选择 bilibili 视频: ID=${bestVideo.id}, Bandwidth=${bestVideo.bandwidth}, Codec=${bestVideo.codecs}`);
    }

    // 音频: 找 ID 最大的, 代表码率最高
    let audioUrl = null;
    let audioQualityId = null;
    if (dash.audio && dash.audio.length > 0) {
        dash.audio.sort((a, b) => b.id - a.id);
        const bestAudio = dash.audio[0];
        audioUrl = bestAudio.baseUrl;
        audioQualityId = bestAudio.id;
        console.debug(`[${new Date().toLocaleString()}] 选择 bilibili 音频: ID=${bestAudio.id}, Bandwidth=${bestAudio.bandwidth}, Codec=${bestAudio.codecs}`);
    }

    return { videoUrl, audioUrl, videoQualityId, audioQualityId };
};

/**
 * 使用 ffmpeg 合并音视频
 */
const mergeStreams = (videoPath, audioPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .outputOptions('-c:v copy') // 视频流直接复制, 不转码
            .outputOptions('-c:a copy') // 音频流直接复制
            .save(outputPath)
            .on('end', () => resolve())
            .on('error', error => reject(err));
    });
};

module.exports = { extractBilibiliUrls };
