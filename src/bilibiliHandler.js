// src/bilibiliHandler.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const stream = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const { uploadResourceToS3 } = require('./downloadProxy');

const pipeline = promisify(stream.pipeline);

// 配置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * 提取 bilibili 视频和音频 URL, 合并并返回本地文件路径
 */
const extractBilibiliUrls = async html => {
    try {
        // 提取 playinfo
        const playinfo = extractPlayInfo(html);
        if (!playinfo) {
            console.error(`[${new Date().toLocaleString()}] 未找到 bilibili playinfo`);
            return [];
        }

        // 选择最佳流
        const { videoUrl, audioUrl } = selectBestStreams(playinfo);
        if (!videoUrl || !audioUrl) {
            console.error(`[${new Date().toLocaleString()}] 未能提取到有效的视频或音频流`);
            return [];
        }

        // 生成唯一文件名
        const fileId = uuidv4();
        const tempDir = path.join(__dirname, '../tmp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const videoPath = path.join(tempDir, `${fileId}_video.m4s`); // B站通常是 m4s
        const audioPath = path.join(tempDir, `${fileId}_audio.m4s`);
        const outputPath = path.join(tempDir, `${fileId}.mp4`);

        // 下载流
        console.log(`[${new Date().toLocaleString()}] 开始下载 bilibili 流...`);
        await Promise.all([
            downloadStream(videoUrl, videoPath),
            downloadStream(audioUrl, audioPath)
        ]);

        // 合并音视频
        console.log(`[${new Date().toLocaleString()}] 开始合并视频...`);
        await mergeStreams(videoPath, audioPath, outputPath);

        // 上传到 S3
        console.log(`[${new Date().toLocaleString()}] 开始上传 bilibili 视频 to S3...`);
        const s3Url = await uploadResourceToS3(outputPath, 'video/mp4', 'bilibili');

        // 清理本地文件
        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);
        fs.unlinkSync(outputPath);

        console.log(`[${new Date().toLocaleString()}] bilibili 视频处理完成: ${s3Url}`);
        return [s3Url];

    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] bilibili 视频处理失败: ${error.message}`);
        return [];
    }
};

/**
 * 从 HTML 中提取 window.__playinfo__
 */
const extractPlayInfo = html => {
    try {
        const startKeyword = 'window.__playinfo__';
        const startIndex = html.indexOf(startKeyword);
        if (startIndex === -1) {
            console.log('extractPlayInfo: keyword not found');
            return null;
        }

        let i = startIndex + startKeyword.length;
        // Scan for the first '{'
        while (i < html.length && html[i] !== '{') {
            i++;
        }

        if (i >= html.length) {
            console.log('extractPlayInfo: starting brace not found');
            return null;
        }

        let braceCount = 0;
        let inString = false;
        let startJsonIndex = i;

        for (; i < html.length; i++) {
            const char = html[i];

            if (char === '"' && (i === 0 || html[i - 1] !== '\\')) {
                inString = !inString;
            }

            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                }
            }

            if (braceCount === 0) {
                const jsonStr = html.substring(startJsonIndex, i + 1);
                return JSON.parse(jsonStr);
            }
        }
    } catch (e) {
        console.error('解析 playinfo 失败', e);
    }
    return null;
};

/**
 * 选择质量最高的视频和音频流
 */
const selectBestStreams = playinfo => {
    const dash = playinfo.data?.dash;
    if (!dash) { return { videoUrl: null, audioUrl: null }; }

    // 视频: 找 id 最大的, 代表清晰度最高, 通常 B 站 DASH 的第一个是最高画质
    const videoUrl = dash.video && dash.video.length > 0 ? dash.video[0].baseUrl : null;

    // 音频: 取 audio 数组第一个
    const audioUrl = dash.audio && dash.audio.length > 0 ? dash.audio[0].baseUrl : null;

    return { videoUrl, audioUrl };
};

/**
 * 下载流文件
 */
const downloadStream = async (url, outputPath) => {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: {
            'Referer': 'https://www.bilibili.com/'
        }
    });

    await pipeline(response.data, fs.createWriteStream(outputPath));
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
            .on('error', err => reject(err));
    });
};

module.exports = { extractBilibiliUrls };
