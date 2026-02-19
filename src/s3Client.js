// src/s3Client.js

const { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

/**
 * 将可读流转换为字符串
 */
const streamToString = async stream => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
};

/**
 * 创建 S3 客户端, 支持 Cloudflare R2、MinIO 等自定义 Endpoint 的 S3 服务
 */
const createS3Client = ({ endpoint, accessKeyId, secretAccessKey }) => {
    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('S3 配置缺失: S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY');
    }

    return new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        tls: endpoint.startsWith('https://')
    });
};

/**
 * 判断对象是否已经存在
 */
const objectExists = async (s3, bucket, key) => {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    } catch (error) {
        // 如果是 404 Not Found, 说明确实不存在
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
        }

        // 如果是 403 Forbidden, 可能是权限限制了 HeadObject
        if (error.$metadata?.httpStatusCode === 403) {
            try {
                // 尝试 GetObject, 这样可以全量获取对象内容, 从而判断对象是否存在, 但比较耗流量
                await s3.send(new GetObjectCommand({
                    Bucket: bucket,
                    Key: key
                }));
                console.log(`[${new Date().toLocaleString()}] S3 ObjectExists (Fallback GetObject) success:`, bucket, key);
                return true;
            } catch (getError) {
                if (getError.name === 'NoSuchKey' || getError.$metadata?.httpStatusCode === 404) {
                    return false;
                }
                // 如果 GetObject 也报 403 或其他, 则记录并视为不存在/错误
                console.error(`[${new Date().toLocaleString()}] S3 ObjectExists (Fallback GetObject) error:`, getError.name, getError.$metadata?.httpStatusCode, getError.message);
                return false;
            }
        }

        // 其他错误 (网络等)
        console.error(`[${new Date().toLocaleString()}] S3 ObjectExists (HeadObject) error:`, error.name, error.$metadata?.httpStatusCode, error.message);
        return false;
    }
};

/**
 * 上传对象
 * options: { IfMatch: string, IfNoneMatch: string }
 */
const putObject = async (s3, bucket, key, body, contentType, options = {}) => {
    const params = {
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        CacheControl: 'public,max-age=31536000,immutable'
    };

    if (options.IfMatch) {
        params.IfMatch = options.IfMatch;
    }
    if (options.IfNoneMatch) {
        params.IfNoneMatch = options.IfNoneMatch;
    }

    const cmd = new PutObjectCommand(params);
    await s3.send(cmd);
};

/**
 * 读取对象内容, 如果对象不存在则返回 null
 * 返回: { content: string, etag: string }
 */
const getObject = async (s3, bucket, key) => {
    try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const content = await streamToString(response.Body);
        return {
            content,
            etag: response.ETag
        };
    } catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
};

module.exports = { createS3Client, objectExists, putObject, getObject };
