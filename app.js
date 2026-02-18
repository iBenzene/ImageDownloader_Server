// app.js

// 加载环境变量
if (process.env.NODE_ENV !== 'production') {
    try {
        require('dotenv').config({ path: '.env.local' });
    } catch (error) {
        console.warn(`Failed to load .env.local: ${error.message}`);
    }
}

const express = require('express');
const app = express();
const port = process.env.PORT || 3080;

// 使用 body-parser 来解析 POST 请求体
const bodyParser = require('body-parser');
app.use(bodyParser.json());

// 引入路由模块
const healthzRouter = require('./routes/healthz');
const extractRouter = require('./routes/api/extract');
const historyRouter = require('./routes/api/history');
const savedLinksRouter = require('./routes/api/savedLinks');

// 使用路由模块
app.use('/healthz', healthzRouter);
app.use('/api/v1/extract', extractRouter);
app.use('/api/v1/history', historyRouter);
app.use('/api/v1/saved-links', savedLinksRouter);

// 从环境变量中读取 Token
const token = process.env.TOKEN || 'default_token';
app.set('token', token);

// 从环境变量中读取 Cookies
const pixivCookie = process.env.PIXIV_COOKIE || '';
const xhsCookie = process.env.XHS_COOKIE || '';
const bilibiliCookie = process.env.BILIBILI_COOKIE || '';
app.set('pixivCookie', pixivCookie);
app.set('xhsCookie', xhsCookie);
app.set('bilibiliCookie', bilibiliCookie);

// 从环境变量中读取 S3 配置
const s3Endpoint = process.env.S3_ENDPOINT || '';
const s3Bucket = process.env.S3_BUCKET || '';
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID || '';
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY || '';
const s3PublicBase = process.env.S3_PUBLIC_BASE || ''; // 可选: CDN 或自定义域名

app.set('s3Endpoint', s3Endpoint);
app.set('s3Bucket', s3Bucket);
app.set('s3AccessKeyId', s3AccessKeyId);
app.set('s3SecretAccessKey', s3SecretAccessKey);
app.set('s3PublicBase', s3PublicBase);

// 从环境变量中读取其他配置
const pixivProxyEnabled = process.env.PIXIV_PROXY_ENABLED === 'false' ? false : true;
app.set('pixivProxyEnabled', pixivProxyEnabled);

// 注册 App 实例
const { setApp } = require('./utils/common');
setApp(app);

// 注册错误处理中间件
app.use((err, req, res, next) => {
    console.error('[' + new Date().toLocaleString() + '] 捕获到错误:', err);
    if (res.headersSent) {
        return next(err);
    }

    try {
        res.status(500).json({
            error: `服务器内部错误: ${err.message}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] 响应客户端失败: ${error.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://0.0.0.0:${port}`);
});
