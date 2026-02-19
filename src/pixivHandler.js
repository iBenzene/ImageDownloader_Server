// src/pixivHandler.js

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const { uploadResourceToS3, getResourceFromS3 } = require('./downloadProxy');
const { getApp, downloadStream } = require('../utils/common');

// 配置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * 提取 Pixiv 动图 URL, 转换为 MP4 视频并上传到 S3
 * data 为 Pixiv API 返回的 JSON 数据 (仅 body 部分)
 */
const extractPixivUgoiraUrls = async (data, illustId) => {
    let tempDir = null;
    try {
        const zipUrl = data.originalSrc;
        const frames = data.frames;

        if (!zipUrl || !frames || frames.length === 0) {
            console.error(`[${new Date().toLocaleString()}] Pixiv 动图数据不完整`);
            return [];
        }

        // 优先检查 S3 是否已有合成后的动图, 命中则直接返回
        const cachedS3Url = await getResourceFromS3(`${illustId}.mp4`, 'pixiv', illustId);
        if (cachedS3Url) {
            console.debug(`[${new Date().toLocaleString()}] Pixiv 动图命中 S3 缓存: ${cachedS3Url}`);
            return [cachedS3Url];
        }

        console.debug(`[${new Date().toLocaleString()}] 检测到 Pixiv 动图, ZIP URL: ${zipUrl}, 帧数: ${frames.length}`);

        // 创建临时目录
        const baseDir = path.join(__dirname, '../tmp');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        tempDir = path.join(baseDir, `pixiv_${illustId}_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const zipPath = path.join(tempDir, `${illustId}.zip`);
        const outputPath = path.join(tempDir, `${illustId}.mp4`);

        // 下载动图帧
        console.debug(`[${new Date().toLocaleString()}] 开始下载 Pixiv 动图帧...`);
        const headers = {
            'Referer': 'https://www.pixiv.net/',
            'Cookie': getApp().get('pixivCookie') || ''
        };
        await downloadStream(zipUrl, zipPath, headers);

        // 解压动图帧
        console.debug(`[${new Date().toLocaleString()}] 解压 Pixiv 动图帧...`);
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(tempDir, true);

        // 生成 ffmpeg 输入列表
        const listPath = path.join(tempDir, 'input.txt');
        let fileContent = '';
        frames.forEach(frame => {
            fileContent += `file '${frame.file}'\n`;
            fileContent += `duration ${frame.delay / 1000}\n`;
        });

        // 追加最后一行, 以避免最后一张图被吞的可能
        if (frames.length > 0) {
            fileContent += `file '${frames[frames.length - 1].file}'\n`;
        }

        fs.writeFileSync(listPath, fileContent);

        // 合成动图
        console.debug(`[${new Date().toLocaleString()}] 开始合成 Pixiv 动图帧...`);
        await mergeUgoira(listPath, outputPath);

        // 上传到 S3
        console.debug(`[${new Date().toLocaleString()}] 开始上传 Pixiv 动图到 S3...`);
        const s3Url = await uploadResourceToS3(outputPath, 'video/mp4', 'pixiv', illustId);

        // 清理临时文件
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;

        console.log(`[${new Date().toLocaleString()}] Pixiv 动图处理完成: ${s3Url}`);
        return [s3Url];

    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] Pixiv 动图处理失败: ${error.message}`);
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

const mergeUgoira = (listPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2']) // 确保宽高是2的倍数
            .save(outputPath)
            .on('end', () => resolve())
            .on('error', error => reject(err));
    });
};

module.exports = { extractPixivUgoiraUrls };
