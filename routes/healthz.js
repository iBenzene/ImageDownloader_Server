// routes/healthz.js

const express = require('express');
const router = express.Router();

// 健康检查接口
router.get('/', (req, res) => {
    return res.send('OK');
});

module.exports = router;
