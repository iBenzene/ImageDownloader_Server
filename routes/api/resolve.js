// routes/api/resolve.js

const router = require('express').Router();
const { resolveContentIdentity } = require('../../src/contentIdentity');

router.get('/', async (req, res) => {
    if (req.query.token !== req.app.get('token')) {
        return res.status(401).json({ error: '认证失败' });
    }
    const { url, downloader } = req.query;
    if (typeof url !== 'string' || typeof downloader !== 'string' || !url || !downloader) {
        return res.status(400).json({ error: '缺少有效的链接或下载器参数' });
    }
    try {
        const contentKey = await resolveContentIdentity(url.trim(), downloader);
        return res.json({ contentKey });
    } catch {
        return res.status(422).json({ error: '无法解析内容身份, 可继续按原链接收藏' });
    }
});

module.exports = router;
