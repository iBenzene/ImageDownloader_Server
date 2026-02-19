// routes/api/savedLinks.js

const express = require('express');
const router = express.Router();

const { getApp } = require('../../utils/common');
const { createS3Client, getObject, putObject } = require('../../src/s3Client');

const SAVED_LINKS_KEY = 'cache/image-downloader/saved-links.json';

/**
 * Merge client records with server records
 * Conflict resolution: keep the record with the latest updated_at
 */
const mergeRecords = (serverRecords, clientRecords) => {
    const recordMap = new Map();

    // Add server records to map
    for (const record of serverRecords) {
        recordMap.set(record.id, record);
    }

    // Merge client records, keeping the one with latest updated_at
    for (const clientRecord of clientRecords) {
        const existingRecord = recordMap.get(clientRecord.id);
        if (!existingRecord) {
            recordMap.set(clientRecord.id, clientRecord);
        } else {
            const existingTime = new Date(existingRecord.updated_at).getTime();
            const clientTime = new Date(clientRecord.updated_at).getTime();
            if (clientTime > existingTime) {
                recordMap.set(clientRecord.id, clientRecord);
            }
        }
    }

    return Array.from(recordMap.values());
};

/**
 * POST /v1/saved-links/sync
 * Incremental sync saved links records
 * 
 * Query params:
 *   - token: authentication token (required)
 *   - since: ISO8601 timestamp, return records updated after this time (optional)
 * 
 * Body:
 *   - records: array of saved link records to sync (optional)
 */
router.post('/sync', async (req, res) => {
    const { token, since } = req.query;
    const app = getApp();

    // Authenticate
    if (token !== app.get('token')) {
        return res.status(401).json({ error: '认证失败' });
    }

    try {
        // Get S3 client config
        const s3 = createS3Client({
            endpoint: app.get('s3Endpoint'),
            accessKeyId: app.get('s3AccessKeyId'),
            secretAccessKey: app.get('s3SecretAccessKey')
        });
        const bucket = app.get('s3Bucket');

        // Optimistic locking retry loop
        const MAX_RETRIES = 10;
        let retries = MAX_RETRIES;
        while (retries > 0) {
            try {
                // Read existing records from S3
                const s3Result = await getObject(s3, bucket, SAVED_LINKS_KEY);

                let serverRecords = [];
                let etag = null;

                if (s3Result) {
                    try {
                        serverRecords = JSON.parse(s3Result.content);
                        etag = s3Result.etag;
                    } catch (parseError) {
                        console.error(`[${new Date().toLocaleString()}] 解析已收藏链接失败: ${parseError.message}`);
                        serverRecords = [];
                    }
                }

                // Merge with client records if provided
                const clientRecords = req.body?.records || [];
                let finalRecords = serverRecords;

                if (clientRecords.length > 0) {
                    finalRecords = mergeRecords(serverRecords, clientRecords);

                    const putOptions = {};
                    if (etag) {
                        putOptions.IfMatch = etag;
                    } else {
                        // File doesn't exist, use If-None-Match: "*" to ensure we don't overwrite if created concurrently
                        putOptions.IfNoneMatch = '*';
                    }

                    // Write back to S3 with Optimistic Locking
                    await putObject(
                        s3,
                        bucket,
                        SAVED_LINKS_KEY,
                        JSON.stringify(finalRecords, null, 2),
                        'application/json',
                        putOptions
                    );
                    console.log(`[${new Date().toLocaleString()}] 同步已收藏链接成功, 共 ${finalRecords.length} 条记录`);
                }

                // Filter records by since parameter
                let recordsToReturn = finalRecords;
                if (since) {
                    const sinceTime = new Date(since).getTime();
                    recordsToReturn = finalRecords.filter(record => {
                        const recordTime = new Date(record.updated_at).getTime();
                        return recordTime > sinceTime;
                    });
                }

                return res.json({
                    records: recordsToReturn,
                    syncedAt: new Date().toISOString()
                });

            } catch (error) {
                // 412 Precondition Failed
                if (error.name === 'PreconditionFailed' || error.$metadata?.httpStatusCode === 412) {
                    const attempt = MAX_RETRIES - retries + 1;
                    console.warn(`[${new Date().toLocaleString()}] 同步已收藏链接冲突, 第 ${attempt} 次重试...`);
                    retries--;
                    if (retries === 0) {
                        throw new Error('服务器繁忙, 请稍后重试', { cause: error });
                    }
                    // Exponential backoff with jitter
                    const delay = Math.min(1000, (Math.pow(2, attempt) * 50) + Math.random() * 200);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw error; // Other errors
            }
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] 同步已收藏链接失败:`, error);
        return res.status(500).json({ error: `同步已收藏链接失败: ${error.message || 'UnknownError'}` });
    }
});

module.exports = router;
